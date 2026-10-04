import { lstat, realpath, open, opendir } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { validateResult, validatePlan, validateTrace } from "@causign/protocol";
import type { SuiteResult } from "@causign/core";
import type { RunPlan, Trace } from "@causign/protocol";
import type {
  ReportRepository,
  ReportSummary,
  ScenarioDetails,
} from "./types.js";
const maxBytes = 16 * 1024 * 1024;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export async function createReportRepository(
  input: string,
): Promise<ReportRepository> {
  const original = resolve(input);
  const rootInfo = await lstat(original);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory())
    throw new Error("Results root must be an existing directory, not a link.");
  const root = await realpath(original);
  const ids = new Map<string, string>();
  async function checked(path: string) {
    const rel = relative(root, path);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error("Artifact outside results root.");
    let current = root;
    for (const part of ["", ...rel.split(sep).filter(Boolean)]) {
      if (part) current = join(current, part);
      const info = await lstat(current);
      if (
        current === root &&
        (info.dev !== rootInfo.dev || info.ino !== rootInfo.ino)
      )
        throw new Error(
          "Results root was replaced or changed. Restart the report viewer.",
        );
      if (info.isSymbolicLink())
        throw new Error("Linked artifacts are unavailable.");
    }
    if ((await realpath(path)) !== path)
      throw new Error("Artifact path changed.");
  }
  async function json(path: string): Promise<unknown> {
    await checked(path);
    const before = await lstat(path);
    if (!before.isFile()) throw new Error("Artifact is not a regular file.");
    const handle = await open(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const opened = await handle.stat();
      if (before.dev !== opened.dev || before.ino !== opened.ino)
        throw new Error("Artifact changed while opening.");
      await checked(path);
      if (opened.size > maxBytes)
        throw new Error("Artifact exceeds 16 MiB limit.");
      const buffer = Buffer.alloc(Math.min(opened.size + 1, maxBytes + 1));
      let count = 0;
      while (count < buffer.length) {
        const read = await handle.read(
          buffer,
          count,
          buffer.length - count,
          null,
        );
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await handle.stat();
      if (count > maxBytes) throw new Error("Artifact exceeds 16 MiB limit.");
      if (
        count !== opened.size ||
        after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs
      )
        throw new Error("Artifact changed while reading.");
      await checked(path);
      const current = await lstat(path);
      if (current.ino !== opened.ino || current.dev !== opened.dev)
        throw new Error("Artifact changed while reading.");
      return JSON.parse(buffer.subarray(0, count).toString("utf8"));
    } finally {
      await handle.close();
    }
  }
  function suite(raw: unknown): SuiteResult {
    if (!raw || typeof raw !== "object")
      throw new Error("Invalid report envelope.");
    const value = raw as Record<string, unknown>;
    if (value.schemaVersion !== "1")
      throw new Error("Unsupported report schema version.");
    if (
      !Array.isArray(value.results) ||
      !Array.isArray(value.diagnostics) ||
      typeof value.interrupted !== "boolean" ||
      ![0, 1, 2, 3, 130].includes(value.exitCode as number)
    )
      throw new Error("Invalid report envelope.");
    const results = value.results.map((result) => validateResult(result));
    validateResult({
      schemaVersion: "1",
      scenarioId: "suite",
      status: "PASS",
      assertions: [],
      diagnostics: value.diagnostics,
    });
    return {
      schemaVersion: "1",
      results,
      diagnostics: value.diagnostics as SuiteResult["diagnostics"],
      exitCode: value.exitCode as number,
      interrupted: value.interrupted,
    };
  }
  async function directory(id: string) {
    const path = ids.get(id);
    if (!path) throw new Error("Unknown report ID. Refresh history.");
    await checked(path);
    if (!(await lstat(path)).isDirectory())
      throw new Error("Report directory unavailable.");
    return path;
  }
  async function load(id: string) {
    const dir = await directory(id);
    return {
      id,
      suite: suite(await json(join(dir, "results.json"))),
      warnings: [],
    };
  }
  async function list() {
    await checked(root);
    const dir = await opendir(root);
    const entries: string[] = [];
    let truncated = false;
    for await (const entry of dir) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (entries.length === 1000) {
        truncated = true;
        break;
      }
      entries.push(entry.name);
    }
    entries.sort((a, b) => {
      const ta = timestamp(a),
        tb = timestamp(b);
      return ta && tb
        ? tb.localeCompare(ta) || a.localeCompare(b)
        : ta
          ? -1
          : tb
            ? 1
            : a.localeCompare(b);
    });
    const reports: ReportSummary[] = [];
    for (const name of entries) {
      const id = createHash("sha256").update(name).digest("hex").slice(0, 24);
      ids.set(id, join(root, name));
      const summary: ReportSummary = {
        id,
        label: name,
        timestamp: timestamp(name),
        counts: { PASS: 0, FAIL: 0, ERROR: 0, INCOMPATIBLE: 0, SKIP: 0 },
      };
      try {
        const value = await load(id);
        for (const result of value.suite.results)
          summary.counts[result.status]++;
        summary.exitCode = value.suite.exitCode;
        summary.interrupted = value.suite.interrupted;
      } catch (error) {
        summary.error = errorText(error);
      }
      reports.push(summary);
    }
    return {
      reports,
      warnings: truncated
        ? ["History truncated at 1,000 execution directories."]
        : [],
    };
  }
  async function scenario(id: string, index: number): Promise<ScenarioDetails> {
    const report = await load(id);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= report.suite.results.length
    )
      throw new Error("Invalid scenario index.");
    const result = report.suite.results[index];
    const dir = await directory(id);
    const d: ScenarioDetails = { result, warnings: [] };
    if (result.planId)
      try {
        const raw = (await json(join(dir, `plan-${index + 1}.json`))) as {
          schemaVersion?: unknown;
          plan?: unknown;
        };
        if (raw.schemaVersion !== "1")
          throw new Error("Unsupported plan schema version.");
        const p: RunPlan = validatePlan(raw.plan);
        if (p.id !== result.planId || p.scenarioId !== result.scenarioId)
          throw new Error("Plan reference mismatch.");
        d.plan = p;
      } catch (error) {
        d.warnings.push(`Plan unavailable: ${errorText(error)}`);
      }
    if (result.traceId)
      try {
        const t: Trace = validateTrace(
          await json(join(dir, `trace-${index + 1}.json`)),
        );
        if (
          t.id !== result.traceId ||
          t.planId !== result.planId ||
          t.runId !== result.runId
        )
          throw new Error("Trace reference mismatch.");
        d.trace = t;
      } catch (error) {
        d.warnings.push(`Trace unavailable: ${errorText(error)}`);
      }
    return d;
  }
  return { list, load, scenario };
}
function timestamp(name: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/.exec(name);
  return match?.[1] ?? null;
}
