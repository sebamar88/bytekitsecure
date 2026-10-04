import { it, expect } from "vitest";
import { suiteExitCode, openProcess } from "../../packages/core/dist/index.js";
import {
  ProtocolSession,
  validateMessage,
  negotiate,
} from "../../packages/protocol/dist/index.js";
import { runBuiltAcceptanceSuite } from "../../scripts/release-acceptance.mjs";
const result = (status: string) => ({ status }) as any;
it("mixed outcomes select severity rather than largest number", () => {
  expect(
    suiteExitCode([
      result("PASS"),
      result("FAIL"),
      result("INCOMPATIBLE"),
      result("ERROR"),
    ]),
  ).toBe(2);
});
it("built CLI runs cross-language and domain examples", async () => {
  expect(await runBuiltAcceptanceSuite()).toMatchObject({
    exitCode: 0,
    domains: ["support", "coding", "devops", "rag", "multi-agent"],
    crossLanguage: true,
  });
}, 60000);
let sequence = 0;
const frame = (type: string, payload: any = {}, extra: any = {}) =>
  ({
    protocol: "causign/1",
    id: `release-${++sequence}`,
    timestamp: "2026-10-01T00:00:00Z",
    type,
    payload,
    ...extra,
  }) as any;
function active() {
  const session = new ProtocolSession(),
    hello = frame("hello", { supportedVersions: ["causign/1"] });
  session.accept(hello, "runner");
  session.accept(
    frame(
      "adapter.ready",
      {
        adapter: { name: "release", version: "1" },
        supportedVersions: ["causign/1"],
        capabilities: [
          "intercept.tools",
          "observe.toolRequests",
          "observe.toolResults",
        ],
      },
      { correlationId: hello.id },
    ),
    "adapter",
  );
  const configure = frame("configure", { protocol: "causign/1" });
  session.accept(configure, "runner");
  session.accept(
    frame("adapter.configured", {}, { correlationId: configure.id }),
    "adapter",
  );
  const start = frame(
    "run.start",
    {
      input: null,
      interceptions: [
        {
          type: "tool",
          name: "lookup",
          response: { kind: "result", value: null },
        },
      ],
      approvalDecisions: [],
      limits: { scenarioTimeoutMs: 1000 },
    },
    { runId: "release-run" },
  );
  session.accept(start, "runner");
  session.accept(
    frame("run.started", {}, { runId: "release-run", correlationId: start.id }),
    "adapter",
  );
  const request = frame(
    "tool.requested",
    { name: "lookup", input: null, intercepted: true },
    { runId: "release-run", operationId: "lookup" },
  );
  session.accept(request, "adapter");
  return { session, request };
}
it("built schemas reject malformed envelopes and negotiation fails closed", () => {
  expect(() => validateMessage(frame("hello", {}))).toThrow();
  const ready = frame(
    "adapter.ready",
    {
      adapter: { name: "release", version: "1" },
      supportedVersions: ["causign/1"],
      capabilities: [],
    },
    { correlationId: "hello" },
  );
  expect(negotiate(ready, ["observe.output"])).toMatchObject({
    status: "INCOMPATIBLE",
  });
  ready.payload.capabilities = ["intercept.tools"];
  expect(negotiate(ready, [])).toMatchObject({ status: "ERROR" });
});
it("built protocol rejects duplicate IDs, late decisions and wrong-type correlations", () => {
  const { session, request } = active();
  expect(() => session.accept(request, "adapter")).toThrow("Duplicate");
  session.finalizeInterrupted("release-run");
  expect(() =>
    session.accept(
      frame(
        "tool.proceed",
        {},
        {
          runId: "release-run",
          operationId: "lookup",
          correlationId: request.id,
        },
      ),
      "runner",
    ),
  ).toThrow("terminal");
  const other = new ProtocolSession(),
    hello = frame("hello", { supportedVersions: ["causign/1"] });
  other.accept(hello, "runner");
  expect(() =>
    other.accept(
      frame("adapter.configured", {}, { correlationId: hello.id }),
      "adapter",
    ),
  ).toThrow("Invalid trigger");
});
it("built process transport retains partial frames, stderr and confirms cleanup", async () => {
  const connection = openProcess({
    command: process.execPath,
    args: [
      "-e",
      "process.stderr.write('diagnostic');process.stdout.write('{partial');",
    ],
  });
  const frames = [];
  for await (const received of connection.frames) frames.push(received);
  expect(frames[0].raw).toBe("{partial");
  expect(frames[0].diagnostic).toBeDefined();
  expect(connection.stderr.text).toBe("diagnostic");
  await connection.close();
  expect(connection.exit).toBeDefined();
});
