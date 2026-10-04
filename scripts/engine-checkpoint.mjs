import { resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { agentTest, expect } from "../packages/sdk/dist/index.js";
import { runSuite } from "../packages/core/dist/index.js";

const output = { customer: "mock" };
const scenario = agentTest("engine static mock checkpoint", {
  agent: "fixture",
  input: null,
  mocks: [
    {
      type: "tool",
      name: "lookup",
      response: { kind: "result", value: output },
    },
  ],
  assertions: [
    expect.tool("lookup").toHaveBeenRequested(),
    expect.tool("lookup").toHaveBeenMocked(),
    expect.tool("lookup").not.toHaveBeenExecuted(),
    expect.output().toEqual(output),
  ],
});
let trace;
const suite = await runSuite(
  [scenario],
  {
    schemaVersion: "1",
    agents: {
      fixture: {
        command: process.execPath,
        args: [resolve("fixtures/process-agent.mjs"), "checkpoint"],
      },
    },
    evaluators: {},
  },
  {
    onTrace: (value) => {
      trace = value;
    },
  },
);
const terminal = trace?.events.find(
  (event) => event.message.type === "run.completed",
);
const evidence = {
  suite,
  trace,
  realExecutions: terminal?.message.payload.metadata?.realExecutions,
};
await writeFile(
  resolve("docs/superpowers/evidence/2026-10-01-engine-checkpoint.json"),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      exitCode: suite.exitCode,
      status: suite.results[0]?.status,
      assertions: suite.results[0]?.assertions.map((value) => ({
        id: value.id,
        status: value.status,
      })),
      completeness: trace?.completeness,
      realExecutions: evidence.realExecutions,
    },
    null,
    2,
  ),
);
process.exitCode = suite.exitCode;
