import { it, expect } from "vitest";
import { request } from "node:http";
import { startReportServer } from "../../src/report/server.js";
import { root, execution, details } from "./fixtures.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
function headers(url: string) {
  return { Authorization: `Bearer ${new URL(url).hash.slice(1)}` };
}
it("serves authenticated history on an assigned loopback port and denies unsafe access", async () => {
  const path = await root();
  await execution(path);
  const h = await startReportServer({ root: path });
  try {
    const url = new URL(h.url);
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
    const base = url.origin;
    expect((await fetch(`${base}/api/history`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/history`, {
          headers: { ...headers(h.url), Origin: "https://attacker.test" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/api/history`, {
          headers: { ...headers(h.url), "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403);
    const list = await (
      await fetch(`${base}/api/history`, { headers: headers(h.url) })
    ).json();
    expect(list.reports[0].counts.FAIL).toBe(1);
    const id = list.reports[0].id;
    const d = await (
      await fetch(`${base}/api/reports/${id}/scenarios/0`, {
        headers: headers(h.url),
      })
    ).json();
    expect(d.explanations[0].differences[0].path).toBe("/greeting");
    expect(
      (
        await fetch(`${base}/api/reports/${id}/scenarios/-1`, {
          headers: headers(h.url),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${base}/api/reports/${id}/scenarios/0?page=-1`, {
          headers: headers(h.url),
        })
      ).status,
    ).toBe(400);
    expect((await fetch(`${base}/package.json`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/reports/outside`, { headers: headers(h.url) }))
        .status,
    ).toBe(400);
    const html = await fetch(base);
    expect(html.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(html.headers.get("cache-control")).toBe("no-store");
  } finally {
    await h.close();
    await h.close();
  }
});
it("rejects a wrong Host header", async () => {
  const h = await startReportServer({ root: await root() });
  try {
    const code = await new Promise<number>((resolve) => {
      const req = request(
        new URL(h.url),
        { headers: { Host: "evil.test", ...headers(h.url) } },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      );
      req.end();
    });
    expect(code).toBe(403);
  } finally {
    await h.close();
  }
});
it("rejects an occupied explicit port and closes on cancellation", async () => {
  const path = await root();
  const c = new AbortController();
  const h = await startReportServer({ root: path, signal: c.signal });
  await expect(
    startReportServer({ root: path, port: Number(new URL(h.url).port) }),
  ).rejects.toThrow(/EADDRINUSE/);
  c.abort();
  await h.closed;
  await expect(fetch(new URL(h.url).origin)).rejects.toThrow();
});
it("rejects invalid ports and already-cancelled startup", async () => {
  const path = await root();
  for (const port of [0, -1, 65536, 1.5])
    await expect(startReportServer({ root: path, port })).rejects.toThrow(
      /port/i,
    );
  const c = new AbortController();
  c.abort();
  await expect(
    startReportServer({ root: path, signal: c.signal }),
  ).rejects.toThrow(/cancel|abort/i);
});
it("paginates timeline in sequence order and bounds simultaneous loads", async () => {
  const path = await root();
  const dir = await execution(path);
  const t = details().trace;
  t.events = Array.from({ length: 401 }, (_, i) => ({
    ...t.events[0],
    receiveSequence: i + 1,
    message: { ...t.events[0].message, id: i === 0 ? "m" : `m${i}` },
  })).reverse();
  await writeFile(join(dir, "trace-1.json"), JSON.stringify(t));
  const h = await startReportServer({ root: path });
  try {
    const base = new URL(h.url).origin;
    const auth = headers(h.url);
    const list = await (
      await fetch(`${base}/api/history`, { headers: auth })
    ).json();
    const route = `${base}/api/reports/${list.reports[0].id}/scenarios/0`;
    const d = await (await fetch(`${route}?page=2`, { headers: auth })).json();
    expect(d.trace.events.map((e: any) => e.receiveSequence)).toEqual([401]);
    expect(d.timeline.totalPages).toBe(3);
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => fetch(route, { headers: auth })),
    );
    expect(responses.some((r) => r.status === 503)).toBe(true);
    await Promise.all(responses.map((r) => r.text()));
  } finally {
    await h.close();
  }
});
it("bounds repeated large differences before serializing an amplified response", async () => {
  const path = await root();
  const dir = await execution(path);
  const d = details();
  d.trace.events[0].message.payload = { output: "x".repeat(1024 * 1024) };
  d.plan.assertions = Array.from({ length: 32 }, (_, i) => ({
    ...d.plan.assertions[0],
    id: `a${i}`,
    parameters: { value: null },
  }));
  d.result.assertions = Array.from({ length: 32 }, (_, i) => ({
    ...d.result.assertions[0],
    id: `a${i}`,
  }));
  await Promise.all([
    writeFile(
      join(dir, "plan-1.json"),
      JSON.stringify({ schemaVersion: "1", plan: d.plan }),
    ),
    writeFile(join(dir, "trace-1.json"), JSON.stringify(d.trace)),
    writeFile(
      join(dir, "results.json"),
      JSON.stringify({
        schemaVersion: "1",
        results: [d.result],
        diagnostics: [],
        exitCode: 1,
        interrupted: false,
      }),
    ),
  ]);
  const h = await startReportServer({ root: path });
  try {
    const base = new URL(h.url).origin;
    const auth = headers(h.url);
    const list = await (
      await fetch(`${base}/api/history`, { headers: auth })
    ).json();
    const response = await fetch(
      `${base}/api/reports/${list.reports[0].id}/scenarios/0`,
      { headers: auth },
    );
    expect(response.status).toBe(422);
    expect(await response.text()).toMatch(/4 MiB/);
  } finally {
    await h.close();
  }
}, 20000);
