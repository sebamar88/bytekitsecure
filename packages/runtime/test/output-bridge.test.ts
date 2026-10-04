import { expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { serveOutputBridge } from "../src/index.js";
const frame = (type: string, payload: unknown, extra = {}) => ({
  protocol: "causign/1",
  id: type,
  timestamp: new Date().toISOString(),
  type,
  payload,
  ...extra,
});
async function exchange(failure = false) {
  const input = new PassThrough(),
    output = new PassThrough(),
    diagnostics = new PassThrough();
  let text = "";
  output.on("data", (chunk) => (text += chunk));
  const served = serveOutputBridge(
    {
      name: "fixture",
      version: "1",
      async execute() {
        if (failure) throw Error("native failed");
        return { text: "hello" };
      },
    },
    { input, output, diagnostics },
  );
  for (const message of [
    frame("hello", { supportedVersions: ["causign/1"] }),
    frame("configure", { protocol: "causign/1" }),
    frame(
      "run.start",
      {
        input: null,
        interceptions: [],
        approvalDecisions: [],
        limits: { scenarioTimeoutMs: 1000 },
      },
      { runId: "run_1" },
    ),
  ])
    input.write(JSON.stringify(message) + "\n");
  await served;
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
it("advertises only output and emits one successful terminal", async () => {
  const messages = await exchange();
  expect(messages[0].payload.capabilities).toEqual(["observe.output"]);
  expect(
    messages.filter((message) =>
      ["run.completed", "run.failed", "run.errored", "run.cancelled"].includes(
        message.type,
      ),
    ),
  ).toHaveLength(1);
  expect(messages.at(-1)).toMatchObject({
    type: "run.completed",
    payload: { output: { text: "hello" } },
  });
});
it("maps native infrastructure failure to run.errored", async () => {
  expect((await exchange(true)).at(-1)).toMatchObject({
    type: "run.errored",
    payload: { error: { message: "native failed" } },
  });
});
it("reports invalid input only on diagnostics", async () => {
  const input = new PassThrough(),
    output = new PassThrough(),
    diagnostics = new PassThrough();
  let stdout = "",
    stderr = "";
  output.on("data", (data) => (stdout += data));
  diagnostics.on("data", (data) => (stderr += data));
  const served = serveOutputBridge(
    {
      name: "test",
      version: "1",
      async execute() {
        return { text: "unused" };
      },
    },
    { input, output, diagnostics },
  );
  input.end("invalid JSON\n");
  await served;
  expect(stdout).toBe("");
  expect(stderr).toMatch(/protocol/i);
});
