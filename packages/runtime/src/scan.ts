import { lstat, readdir, realpath, open } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import type {
  AgentCandidate,
  DiscoveryLimits,
  DiscoveryReport,
  DiscoverySource,
  Registry,
  SourceFile,
} from "./types.js";
export const defaultDiscoveryLimits: DiscoveryLimits = {
  maxFiles: 10000,
  maxFileBytes: 1048576,
  maxTotalBytes: 33554432,
  timeoutMs: 10000,
};
const excluded = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".causign",
  ".superpowers",
]);
export const contentHash = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex");
export function candidateId(
  discovererId: string,
  source: string,
  nativeId: string,
): string {
  return contentHash(JSON.stringify([discovererId, source, nativeId]));
}
async function readBounded(path: string, max: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const data = Buffer.alloc(max + 1);
    let used = 0;
    while (used < data.length) {
      const { bytesRead } = await handle.read(
        data,
        used,
        data.length - used,
        null,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    if (used > max) throw new Error("scan.limit");
    return data.subarray(0, used);
  } finally {
    await handle.close();
  }
}
export async function readVerifiedCandidate(
  candidate: AgentCandidate,
): Promise<string> {
  if (candidate.source.kind !== "file")
    throw new Error("Service revisions must be verified by their adapter");
  const info = await lstat(candidate.source.path);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size > defaultDiscoveryLimits.maxFileBytes
  )
    throw new Error("Candidate source changed or unsupported");
  const bytes = await readBounded(
    candidate.source.path,
    defaultDiscoveryLimits.maxFileBytes,
  );
  if (contentHash(bytes) !== candidate.revision)
    throw new Error("Candidate definition changed; rediscover before launch");
  return bytes.toString("utf8");
}
export async function verifyCandidateRevision(
  candidate: AgentCandidate,
): Promise<void> {
  await readVerifiedCandidate(candidate);
}
export async function discoverAgents(
  registry: Registry,
  source: DiscoverySource,
  options: {
    discovererId?: string;
    limits?: Partial<DiscoveryLimits>;
    signal?: AbortSignal;
  } = {},
): Promise<DiscoveryReport> {
  const limits = { ...defaultDiscoveryLimits, ...options.limits };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Discovery limits must be positive integers");
  const wanted =
    options.discovererId ??
    (source.kind === "service" ? source.discovererId : undefined);
  const discoverers = registry.discoverers.filter(
    (item) =>
      (!wanted || item.id === wanted) && item.sourceKinds.includes(source.kind),
  );
  if (wanted && !discoverers.length)
    throw new Error(`Unknown or incompatible discoverer: ${wanted}`);
  const report: DiscoveryReport = {
      candidates: [],
      diagnostics: [],
      complete: true,
    },
    controller = new AbortController();
  const cancel = () => controller.abort(new Error("scan.cancelled"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(
    () => controller.abort(new Error("scan.timeout")),
    limits.timeoutMs,
  );
  const files: SourceFile[] = [];
  let count = 0,
    total = 0;
  const check = () => {
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  const walk = async (path: string): Promise<void> => {
    check();
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        await walk(join(path, entry.name));
      }
      return;
    }
    if (!info.isFile()) return;
    if (
      ++count > limits.maxFiles ||
      info.size > limits.maxFileBytes ||
      total + info.size > limits.maxTotalBytes
    )
      throw new Error("scan.limit");
    const bytes = await readBounded(
      path,
      Math.min(limits.maxFileBytes, limits.maxTotalBytes - total),
    );
    check();
    total += bytes.length;
    files.push({
      path: await realpath(path),
      text: bytes.toString("utf8"),
      revision: contentHash(bytes),
    });
  };
  try {
    check();
    if (source.kind === "file") {
      const root = resolve(source.path),
        info = await lstat(root);
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
        throw new Error("scan.unsupported-root");
      await walk(root);
    }
    for (const discoverer of discoverers) {
      check();
      let listener: () => void = () => {};
      try {
        const result = await Promise.race([
          discoverer.discover(source, {
            limits,
            signal: controller.signal,
            files: Object.freeze(files),
          }),
          new Promise<never>((_, reject) => {
            listener = () => reject(controller.signal.reason);
            controller.signal.addEventListener("abort", listener, {
              once: true,
            });
          }),
        ]);
        check();
        if (
          !result ||
          !Array.isArray(result.candidates) ||
          !Array.isArray(result.diagnostics) ||
          typeof result.complete !== "boolean"
        )
          throw new Error(`Invalid discovery report: ${discoverer.id}`);
        for (const candidate of result.candidates) {
          if (
            candidate.discovererId !== discoverer.id ||
            !candidate.id ||
            !candidate.revision ||
            !candidate.name ||
            !["agent", "instructions"].includes(candidate.kind)
          )
            throw new Error(`Invalid candidate: ${discoverer.id}`);
          report.candidates.push({
            ...candidate,
            adapterIds: registry.match(candidate),
          });
        }
        report.diagnostics.push(...result.diagnostics);
        report.complete &&= result.complete;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        report.complete = false;
        report.diagnostics.push({
          code: "plugin.discovery",
          message: error instanceof Error ? error.message : String(error),
          source: discoverer.id,
          severity: "error",
        });
      } finally {
        controller.signal.removeEventListener("abort", listener);
      }
    }
    if (
      !discoverers.length ||
      (files.length > 0 && !report.candidates.length && report.complete)
    )
      report.diagnostics.push({
        code: "source.unrecognized",
        message:
          "No registered discoverer recognized agent definitions in this source",
        severity: "warning",
      });
  } catch (error) {
    report.complete = false;
    const message = error instanceof Error ? error.message : String(error);
    report.diagnostics.push({
      code: message.startsWith("scan.") ? message : "scan.error",
      message:
        message === "scan.limit"
          ? "Discovery limit reached; source scan is incomplete"
          : message,
      severity: "error",
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
  const ids = new Set<string>();
  for (const candidate of report.candidates) {
    if (ids.has(candidate.id)) {
      report.complete = false;
      report.diagnostics.push({
        code: "candidate.duplicate",
        message: "Duplicate candidate identity",
        severity: "error",
      });
    }
    ids.add(candidate.id);
  }
  report.candidates.sort((a, b) => a.id.localeCompare(b.id));
  return report;
}
