import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReportRepository } from "./repository.js";
import { explainAssertion } from "./explain.js";
import { html } from "./web/html.js";
import { style } from "./web/style.js";
import { encodeReportJson, ReportResponseLimit } from "./response.js";
export interface ReportServerOptions {
  root: string;
  port?: number;
  selectedReportId?: string;
  signal?: AbortSignal;
}
export interface ReportServerHandle {
  url: string;
  closed: Promise<void>;
  close(): Promise<void>;
}
export async function startReportServer(
  options: ReportServerOptions,
): Promise<ReportServerHandle> {
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  )
    throw new Error("Invalid port: use 1 through 65535.");
  if (options.signal?.aborted) throw new Error("Report startup cancelled.");
  const repository = await createReportRepository(options.root);
  await repository.list();
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let active = 0;
  const server = createServer(async (req, res) => {
    const reply = (code: number, data: unknown, type = "application/json") => {
      if (res.destroyed) return;
      const body =
        type === "application/json" ? encodeReportJson(data) : (data as string);
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      });
      res.end(body);
    };
    if (
      req.headers.host !== origin.slice(7) ||
      (req.headers.origin && req.headers.origin !== origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      reply(403, { error: "Local origin required." });
      return;
    }
    if (req.method !== "GET") {
      reply(405, { error: "Read-only report server." });
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "/", origin);
    } catch {
      reply(400, { error: "Invalid request." });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const auth = req.headers.authorization ?? "";
      const expected = `Bearer ${token}`;
      if (
        Buffer.byteLength(auth) !== expected.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))
      ) {
        reply(401, {
          error: "Report session expired or missing. Reopen the printed URL.",
        });
        return;
      }
      if (active >= 4) {
        reply(503, { error: "Report loader is busy. Retry shortly." });
        return;
      }
      active++;
      try {
        if (url.pathname === "/api/history") {
          reply(200, {
            ...(await repository.list()),
            selectedReportId: options.selectedReportId,
          });
          return;
        }
        const match =
          /^\/api\/reports\/([a-f0-9]{24})(?:\/scenarios\/(\d+))?$/.exec(
            url.pathname,
          );
        if (!match) {
          reply(400, { error: "Invalid report or scenario ID." });
          return;
        }
        if (match[2] === undefined) {
          reply(200, await repository.load(match[1]));
          return;
        }
        const pageText = url.searchParams.get("page") ?? "0";
        if (
          !/^\d+$/.test(pageText) ||
          !Number.isSafeInteger(Number(pageText))
        ) {
          reply(400, { error: "Invalid timeline page." });
          return;
        }
        const page = Number(pageText);
        const d = await repository.scenario(match[1], Number(match[2]));
        const events =
          d.trace?.events
            .slice()
            .sort((a, b) => a.receiveSequence - b.receiveSequence) ?? [];
        const totalPages = Math.ceil(events.length / 200);
        if (page >= Math.max(1, totalPages)) {
          reply(400, { error: "Timeline page unavailable." });
          return;
        }
        reply(200, {
          ...d,
          trace: d.trace
            ? { ...d.trace, events: events.slice(page * 200, (page + 1) * 200) }
            : undefined,
          explanations: d.result.assertions.map((_, i) =>
            explainAssertion(d, i),
          ),
          timeline: { page, totalPages, totalEvents: events.length },
        });
      } catch (error) {
        reply(error instanceof ReportResponseLimit ? 422 : 400, {
          error: error instanceof Error ? error.message : "Report unavailable.",
        });
      } finally {
        active--;
      }
      return;
    }
    if (url.pathname === "/") {
      reply(200, html, "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/style.css") {
      reply(200, style, "text/css; charset=utf-8");
      return;
    }
    const assets: Record<string, string> = {
      "/client.js": "./web/client.js",
      "/session.js": "./web/session.js",
      "/navigation.js": "./web/navigation.js",
    };
    if (Object.hasOwn(assets, url.pathname)) {
      try {
        reply(
          200,
          await readFile(
            new URL(assets[url.pathname], import.meta.url),
            "utf8",
          ),
          "text/javascript; charset=utf-8",
        );
      } catch {
        reply(500, {
          error: "Report assets unavailable. Build or reinstall the CLI.",
        });
      }
      return;
    }
    reply(404, { error: "Not found." });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxConnections = 32;
  let resolveClosed: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  let closing = false;
  const close = async () => {
    if (!closing) {
      closing = true;
      server.close(() => resolveClosed());
      server.closeAllConnections();
      options.signal?.removeEventListener("abort", onAbort);
    }
    await closed;
  };
  const onAbort = () => {
    void close();
  };
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Report server did not bind.");
  origin = `http://127.0.0.1:${address.port}`;
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) await close();
  return { url: `${origin}/#${token}`, closed, close };
}
