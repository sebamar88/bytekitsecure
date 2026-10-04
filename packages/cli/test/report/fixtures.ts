import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { RunPlan, Trace, ScenarioResult } from "@causign/protocol";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
export async function root() {
  const path = await mkdtemp(join(tmpdir(), "causign report "));
  roots.push(path);
  return path;
}
export function details() {
  const plan: RunPlan = {
    id: "p",
    scenarioId: "greeting",
    agent: { command: "fixture", args: [] },
    protocol: "causign/1",
    capabilities: ["observe.output"],
    input: null,
    requirements: [],
    interceptions: [],
    approvalDecisions: [],
    assertions: [
      {
        id: "greeting",
        type: "output.equal",
        parameters: { value: { greeting: "Hello asd" } },
        negated: false,
        requirements: ["observe.output"],
      },
    ],
    limits: { scenarioTimeoutMs: 1000 },
  };
  const trace: Trace = {
    schemaVersion: "1",
    id: "t",
    planId: "p",
    runId: "r",
    completeness: "complete",
    diagnostics: [],
    terminal: { type: "run.completed", source: "adapter", messageId: "m" },
    events: [
      {
        receiveSequence: 1,
        source: "adapter",
        message: {
          protocol: "causign/1",
          id: "m",
          runId: "r",
          type: "run.completed",
          timestamp: "2026-10-02T12:00:00Z",
          payload: { output: { greeting: "Hello" } },
        },
      },
    ],
  };
  const result: ScenarioResult = {
    schemaVersion: "1",
    scenarioId: "greeting",
    runId: "r",
    planId: "p",
    traceId: "t",
    status: "FAIL",
    diagnostics: [],
    assertions: [
      {
        id: "greeting",
        status: "FAIL",
        expected: "output.equal greeting Hello asd",
        observed: "Hello",
        reason: "Compared structural final JSON output.",
        evidence: [{ kind: "message", messageId: "m" }],
      },
    ],
  };
  return { result, plan, trace, warnings: [] };
}
export async function execution(
  base: string,
  name = "2026-10-02T12-00-00-000Z-example",
) {
  const dir = join(base, name);
  await mkdir(dir);
  const d = details();
  await writeFile(
    join(dir, "results.json"),
    JSON.stringify({
      schemaVersion: "1",
      results: [d.result],
      diagnostics: [],
      exitCode: 1,
      interrupted: false,
      artifacts: {
        plans: { p: "Z:/stale/plan-1.json" },
        traces: { t: "Z:/stale/trace-1.json" },
      },
    }),
  );
  await writeFile(
    join(dir, "plan-1.json"),
    JSON.stringify({ schemaVersion: "1", plan: d.plan }),
  );
  await writeFile(join(dir, "trace-1.json"), JSON.stringify(d.trace));
  return dir;
}
