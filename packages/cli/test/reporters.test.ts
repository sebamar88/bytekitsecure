import { it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportConsole } from "../src/reporters/console.js";
import { writeArtifacts } from "../src/reporters/json.js";
import { artifactPaths } from "../src/reporters/json.js";
const evidenceSuite: any = {
  schemaVersion: "1",
  exitCode: 1,
  interrupted: false,
  diagnostics: [],
  results: [
    {
      schemaVersion: "1",
      scenarioId: "s",
      status: "FAIL",
      assertions: [
        {
          id: "a",
          status: "FAIL",
          expected: "expected value",
          observed: "observed value",
          reason: "original reason",
          evidence: [
            { kind: "message", messageId: "msg_81", operationId: "op_7" },
            { kind: "metric", metric: "cost", value: 2, currency: "USD" },
            {
              kind: "evaluator",
              evaluatorId: "judge",
              configHash: "abc",
              provider: "p",
              model: "m",
              score: 0.2,
            },
          ],
        },
      ],
      diagnostics: [
        {
          kind: "invalid-frame",
          message: "invalid",
          rawFrame: "RAW",
          truncated: true,
        },
        { kind: "stderr", message: "STDERR" },
      ],
    },
  ],
};
it("reports failure with the original evidence", () => {
  const text = reportConsole(evidenceSuite);
  for (const value of [
    "msg_81",
    "FAIL",
    "op_7",
    "expected value",
    "observed value",
    "original reason",
    "cost",
    "judge",
    "abc",
    "0.2",
  ])
    expect(text).toContain(value);
});
it("bounds verbose raw frames and stderr and marks truncation", () => {
  const suite = structuredClone(evidenceSuite);
  suite.results[0].diagnostics[0].rawFrame = "x".repeat(10000);
  const text = reportConsole(suite, { verbose: true });
  expect(text).toContain("[truncated]");
  expect(text).toContain("STDERR");
  expect(text.length).toBeLessThan(6000);
  expect(reportConsole(suite)).not.toContain("RAW");
});
it("writes versioned results and exact captured plan/trace references", async () => {
  const dir = await mkdtemp(join(tmpdir(), "causign artifacts "));
  await writeArtifacts(evidenceSuite, dir);
  const data = JSON.parse(await readFile(join(dir, "results.json"), "utf8"));
  expect(data.schemaVersion).toBe("1");
  expect(data.results[0].assertions[0].evidence[0].messageId).toBe("msg_81");
});
it("arbitrary reference IDs never escape artifact directory or collide with object prototypes", () => {
  const suite = structuredClone(evidenceSuite);
  suite.results[0].scenarioId = "../outside";
  suite.results[0].planId = "__proto__";
  suite.results[0].traceId = "../trace:escape";
  const dir = join(tmpdir(), "safe artifacts");
  const paths = artifactPaths(suite, dir);
  expect(paths.plans["__proto__"]).toBe(join(dir, "plan-1.json"));
  expect(paths.traces["../trace:escape"]).toBe(join(dir, "trace-1.json"));
});
