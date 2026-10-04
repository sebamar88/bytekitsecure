import { describe, it, expect } from "vitest";
import {
  runScenario,
  runSuite,
  suiteExitCode,
  executePlan,
} from "../src/execute.js";
import { prepareScenario, negotiateScenario } from "../src/compile.js";
import type { ScenarioDefinition, CausignConfig } from "@causign/protocol";
import { resolve } from "node:path";
import { TraceCollector } from "../src/trace.js";
import type { RunPlan } from "@causign/protocol";
describe("diagnostic previews", () => {
  const collect = (message: string, truncated = false, rawFrame?: string) => {
    const collector = new TraceCollector(
      { id: "plan" } as RunPlan,
      "run",
      1024,
      10,
    );
    collector.diagnostic({
      kind: "stderr",
      message,
      truncated,
      ...(rawFrame !== undefined ? { rawFrame } : {}),
    });
    return collector.trace.diagnostics[0];
  };
  it("marks a shortened message as truncated", () => {
    expect(collect("x".repeat(600))).toMatchObject({
      message: "x".repeat(512),
      truncated: true,
    });
  });
  it("preserves short messages and upstream truncation", () => {
    expect(collect("short")).toMatchObject({
      message: "short",
      truncated: false,
    });
    expect(collect("short", true).truncated).toBe(true);
    expect(collect("x".repeat(512)).truncated).toBe(false);
  });
  it("preserves raw frame truncation", () => {
    expect(collect("short", false, "r".repeat(600))).toMatchObject({
      rawFrame: "r".repeat(512),
      truncated: true,
    });
    expect(collect("short", false, "raw").truncated).toBe(false);
  });
  it("keeps multibyte previews within 512 bytes without splitting characters", () => {
    const retained = collect(
      "a".repeat(511) + "😀",
      false,
      "a".repeat(511) + "é",
    );
    expect(retained.message).toBe("a".repeat(511));
    expect(retained.rawFrame).toBe("a".repeat(511));
    expect(retained.truncated).toBe(true);
    expect(Buffer.byteLength(retained.message)).toBeLessThanOrEqual(512);
    expect(Buffer.byteLength(retained.rawFrame!)).toBeLessThanOrEqual(512);
  });
});
const def: ScenarioDefinition = {
  schemaVersion: "1",
  id: "s",
  name: "s",
  agent: "a",
  input: null,
  mocks: [],
  assertions: [],
  requirements: [],
  timeoutMs: 100,
};
const config: CausignConfig = {
  schemaVersion: "1",
  agents: { a: { command: process.execPath, args: [] } },
  evaluators: {},
};
describe("execution", () => {
  it("closes a supplied connection once when direct plan validation fails", async () => {
    const c = fixture([]);
    let closes = 0;
    const close = c.close.bind(c);
    c.close = async () => {
      closes++;
      await close();
    };
    const r = await executePlan({ id: "invalid" } as any, c, {});
    expect(r.status).toBe("ERROR");
    expect(closes).toBe(1);
    expect(c.sent).toHaveLength(0);
    expect(r.runId).toBeUndefined();
  });
  it("preserves rejected run.start diagnostics without inventing a terminal", async () => {
    let plan: any;
    await runScenario(
      {
        ...def,
        mocks: [
          {
            type: "tool",
            name: "delete",
            response: { kind: "result", value: null },
          },
        ],
      },
      config,
      {
        connectionFactory: () =>
          fixture([
            "intercept.tools",
            "observe.toolRequests",
            "observe.toolResults",
          ]),
        onPlan: (p) => {
          plan = p;
        },
      },
    );
    plan.interceptions.push(structuredClone(plan.interceptions[0]));
    let trace: any;
    const c = fixture([
      "intercept.tools",
      "observe.toolRequests",
      "observe.toolResults",
    ]);
    const r = await executePlan(plan, c, {
      onTrace: (t) => {
        trace = t;
      },
    });
    expect(r.status).toBe("ERROR");
    expect(
      r.diagnostics.some((d) => d.message.includes("Duplicate interceptions")),
    ).toBe(true);
    expect(r.diagnostics.some((d) => d.message.includes("Unknown run"))).toBe(
      false,
    );
    expect(c.sent.some((m) => m.type === "run.start")).toBe(false);
    expect(trace).toBeDefined();
    expect(trace.terminal).toBeUndefined();
    expect(trace.events).toHaveLength(0);
  });
  it("reexecutes immutable plans with fresh run IDs and revalidates connection coverage", async () => {
    const prepared = prepareScenario(def, config);
    const negotiated = negotiateScenario(prepared, {
      protocol: "causign/1",
      id: "ready",
      type: "adapter.ready",
      timestamp: new Date().toISOString(),
      correlationId: "hello",
      payload: {
        adapter: { name: "f", version: "1" },
        supportedVersions: ["causign/1"],
        capabilities: [],
      },
    });
    if (negotiated.status !== "READY")
      throw new Error("Fixture plan incompatible");
    const plan = negotiated.plan;
    const snapshot = JSON.stringify(plan);
    const first = await executePlan(plan, fixture([]), {}),
      second = await executePlan(plan, fixture([]), {});
    expect(first.status).toBe("PASS");
    expect(first.planId).toBe(second.planId);
    expect(first.runId).not.toBe(second.runId);
    expect(JSON.stringify(plan)).toBe(snapshot);
    const mismatch = fixture(["observe.output"]);
    expect((await executePlan(plan, mismatch, {})).status).toBe("ERROR");
    expect(mismatch.sent.some((m) => m.type === "run.start")).toBe(false);
  });
  it("executes real process handshake and static mock without real execution", async () => {
    let trace: any;
    const r = await runScenario(
      {
        ...def,
        timeoutMs: 2000,
        mocks: [
          {
            type: "tool",
            name: "lookup",
            response: { kind: "result", value: { customer: "mock" } },
          },
        ],
        assertions: [
          {
            id: "mock",
            type: "tool.mocked",
            parameters: { name: "lookup" },
            negated: false,
            requirements: [],
          },
        ],
      },
      {
        ...config,
        agents: {
          a: {
            command: process.execPath,
            args: [resolve("fixtures/process-agent.mjs"), "checkpoint"],
          },
        },
      },
      {
        onTrace: (t) => {
          trace = t;
        },
      },
    );
    expect(r.status).toBe("PASS");
    expect(
      trace.events.find((e: any) => e.message.type === "run.completed").message
        .payload.metadata.realExecutions,
    ).toBe(0);
  });
  it("configured approval chooses exact structural input before fallback", async () => {
    const c = fixture(["observe.approvals", "control.approvals"], "approval");
    const r = await runScenario(
      {
        ...def,
        approvalDecisions: [
          { decision: "grant" },
          { input: { a: 1, b: 2 }, decision: "reject" },
        ],
      },
      config,
      { connectionFactory: () => c },
    );
    expect(r.status).toBe("PASS");
    expect(
      c.sent.find((m) => m.type === "approval.resolve").payload.decision,
    ).toBe("reject");
  });
  it("unconfigured approval fails closed", async () => {
    const c = fixture(["observe.approvals"], "approval");
    const r = await runScenario(def, config, { connectionFactory: () => c });
    expect(r.status).toBe("ERROR");
    expect(c.sent.some((m) => m.type === "approval.resolve")).toBe(false);
  });
  it("artifact callback errors preserve execution facts and assertions", async () => {
    const r = await runScenario(
      {
        ...def,
        assertions: [
          {
            id: "o",
            type: "output.equal",
            parameters: { value: null },
            negated: false,
            requirements: [],
          },
        ],
      },
      config,
      {
        connectionFactory: () => fixture(["observe.output"]),
        onTrace: () => {
          throw new Error("disk full");
        },
      },
    );
    expect(r.status).toBe("ERROR");
    expect(r.runId).toBeDefined();
    expect(r.traceId).toBeDefined();
    expect(r.assertions[0].status).toBe("PASS");
    expect(r.diagnostics.at(-1)?.kind).toBe("artifact-error");
  });
  it("preflights every scenario before spawning", async () => {
    let spawned = 0;
    await expect(
      runSuite([def, { ...def, id: "bad", agent: "unknown" }], config, {
        connectionFactory: () => {
          spawned++;
          return fixture([]);
        },
      }),
    ).rejects.toThrow("Unknown agent");
    expect(spawned).toBe(0);
  });
  it("does not start incompatible runs", async () => {
    const r = await runScenario({ ...def, requirements: ["unknown"] }, config, {
      connectionFactory: () => fixture([]),
    });
    expect(r.status).toBe("INCOMPATIBLE");
    expect(r.runId).toBeUndefined();
  });
  it("unsupported version is incompatible but malformed correlation is error", async () => {
    const c = fixture([], "version");
    const r = await runScenario(def, config, { connectionFactory: () => c });
    expect(r.status).toBe("INCOMPATIBLE");
    expect(c.sent.some((m) => m.type === "run.start")).toBe(false);
    expect(
      (
        await runScenario(def, config, {
          connectionFactory: () => fixture([], "wrong-correlation"),
        })
      ).status,
    ).toBe("ERROR");
  });
  it("timeout never releases an intercepted side effect", async () => {
    const c = fixture(
      ["intercept.tools", "observe.toolRequests", "observe.toolResults"],
      "pending",
    );
    const r = await runScenario(
      {
        ...def,
        mocks: [
          {
            type: "tool",
            name: "delete",
            response: { kind: "result", value: null },
          },
        ],
      },
      config,
      { connectionFactory: () => c, limits: { interceptionTimeoutMs: 10 } },
    );
    expect(r.status).toBe("ERROR");
    expect(c.sent.some((m) => m.type === "tool.proceed")).toBe(false);
  });
  it("empty suite is an error", async () =>
    expect((await runSuite([], config, {})).exitCode).toBe(2));
  it("uses severity precedence", () => {
    const result = (status: any) => ({
      schemaVersion: "1" as const,
      scenarioId: "s",
      status,
      assertions: [],
      diagnostics: [],
    });
    expect(suiteExitCode([result("FAIL"), result("INCOMPATIBLE")])).toBe(3);
    expect(suiteExitCode([result("ERROR"), result("INCOMPATIBLE")])).toBe(2);
    expect(suiteExitCode([], true)).toBe(130);
  });
  it("records complete output and monotonic duration", async () => {
    let trace: any;
    const r = await runScenario(
      {
        ...def,
        assertions: [
          {
            id: "o",
            type: "output.equal",
            parameters: { value: null },
            negated: false,
            requirements: [],
          },
        ],
      },
      config,
      {
        connectionFactory: () => fixture(["observe.output"]),
        onTrace: (t) => {
          trace = t;
        },
      },
    );
    expect(r.status).toBe("PASS");
    expect(trace.completeness).toBe("complete");
    expect(r.executionDurationMs).toBeGreaterThanOrEqual(0);
  });
  it("isolates sequential run and plan identities", async () => {
    const result = await runSuite(
      [
        { ...def, id: "a" },
        { ...def, id: "b" },
      ],
      config,
      { connectionFactory: () => fixture([]) },
    );
    expect(result.exitCode).toBe(0);
    expect(new Set(result.results.map((r) => r.runId)).size).toBe(2);
    expect(new Set(result.results.map((r) => r.planId)).size).toBe(2);
  });
  it("does not spawn explicitly skipped scenarios", async () => {
    const r = await runScenario({ ...def, skipReason: "later" }, config, {
      connectionFactory: () => {
        throw new Error("spawned");
      },
    });
    expect(r.status).toBe("SKIP");
    expect(r.runId).toBeUndefined();
  });
  it("rejects duplicate scenario IDs before spawning", async () => {
    let spawned = 0;
    await expect(
      runSuite([def, def], config, {
        connectionFactory: () => {
          spawned++;
          return fixture([]);
        },
      }),
    ).rejects.toThrow("Duplicate");
    expect(spawned).toBe(0);
  });
  it.each(["maxMessages", "maxTraceBytes"] as const)(
    "bounds trace using %s and keeps synthetic terminal incomplete",
    async (limit) => {
      let trace: any;
      const r = await runScenario(def, config, {
        connectionFactory: () => fixture([]),
        limits: { [limit]: 1 },
        onTrace: (t) => {
          trace = t;
        },
      });
      expect(r.status).toBe("ERROR");
      expect(r.diagnostics.some((d) => d.kind === "trace-limit-exceeded")).toBe(
        true,
      );
      expect(trace.completeness).toBe("incomplete");
      expect(trace.terminal.source).toBe("runner");
      const retained =
        trace.events.reduce(
          (n: number, e: any) =>
            n + Buffer.byteLength(JSON.stringify(e.message)),
          0,
        ) +
        trace.diagnostics.reduce(
          (n: number, d: any) => n + Buffer.byteLength(JSON.stringify(d)),
          0,
        );
      expect(retained).toBeLessThanOrEqual(
        (limit === "maxTraceBytes" ? 1 : 33554432) + 8192,
      );
    },
  );
  it("missing promised final cost produces ERROR", async () => {
    const r = await runScenario(def, config, {
      connectionFactory: () => fixture(["observe.cost"]),
    });
    expect(r.status).toBe("ERROR");
  });
  it("missing final output produces ERROR", async () => {
    const r = await runScenario(def, config, {
      connectionFactory: () => fixture(["observe.output"], "missing-output"),
    });
    expect(r.status).toBe("ERROR");
  });
  it("spontaneous cancellation produces ERROR", async () => {
    const r = await runScenario(def, config, {
      connectionFactory: () => fixture([], "cancel"),
    });
    expect(r.status).toBe("ERROR");
  });
  it("late frames retain one adapter terminal and cause ERROR", async () => {
    let trace: any;
    const r = await runScenario(def, config, {
      connectionFactory: () => fixture(["observe.messages"], "late"),
      onTrace: (t) => {
        trace = t;
      },
    });
    expect(r.status).toBe("ERROR");
    expect(trace.terminal.source).toBe("adapter");
    expect(
      trace.events.filter(
        (e: any) =>
          e.message.type.startsWith("run.") &&
          ["run.completed", "run.errored"].includes(e.message.type),
      ),
    ).toHaveLength(1);
  });
  it("explicit interruption returns suite exit 130", async () => {
    const control = new AbortController();
    control.abort();
    const r = await runSuite([def], config, { signal: control.signal });
    expect(r.exitCode).toBe(130);
  });
  it("preserves positive facts and does not prove absent negative facts on error", async () => {
    const assertions: any[] = [
      {
        id: "requested",
        type: "tool.requested",
        parameters: { name: "delete" },
        negated: false,
        requirements: [],
      },
      {
        id: "absent",
        type: "tool.completed",
        parameters: { name: "other" },
        negated: true,
        requirements: [],
      },
    ];
    const r = await runScenario(
      {
        ...def,
        mocks: [
          {
            type: "tool",
            name: "delete",
            response: { kind: "result", value: null },
          },
        ],
        assertions,
      },
      config,
      {
        connectionFactory: () =>
          fixture(
            ["intercept.tools", "observe.toolRequests", "observe.toolResults"],
            "pending",
          ),
        limits: { interceptionTimeoutMs: 10 },
      },
    );
    expect(r.assertions.map((a) => a.status)).toEqual([
      "PASS",
      "NOT_EVALUATED",
    ]);
  });
});
function fixture(capabilities: string[], mode = "complete") {
  const queue: any[] = [];
  let wake: () => void = () => {};
  let closed = false;
  let id = 0;
  const sent: any[] = [];
  const emit = (type: string, payload: any, extra: any = {}) => {
    if (type === "adapter.ready" && mode === "version")
      payload.supportedVersions = ["causign/2"];
    if (type === "adapter.ready" && mode === "wrong-correlation")
      extra.correlationId = "unknown";
    queue.push({
      receiveSequence: ++id,
      raw: "",
      rawBytes: 1,
      truncated: false,
      message: {
        protocol: "causign/1",
        id: `a${id}`,
        timestamp: new Date().toISOString(),
        type,
        payload,
        ...extra,
      },
    });
    wake();
  };
  return {
    sent,
    stderr: { text: "", truncated: false, totalBytes: 0 },
    bufferedBytes: 0,
    receivedBytes: 0,
    exit: undefined,
    async send(m: any) {
      sent.push(m);
      if (m.type === "hello")
        emit(
          "adapter.ready",
          {
            adapter: { name: "f", version: "1" },
            supportedVersions: ["causign/1"],
            capabilities,
          },
          { correlationId: m.id },
        );
      if (m.type === "configure")
        emit("adapter.configured", {}, { correlationId: m.id });
      if (m.type === "run.start") {
        emit("run.started", {}, { runId: m.runId, correlationId: m.id });
        if (mode === "pending")
          emit(
            "tool.requested",
            { name: "delete", input: null, intercepted: true },
            { runId: m.runId, operationId: "op" },
          );
        else if (mode === "approval")
          emit(
            "approval.requested",
            { input: { b: 2, a: 1 } },
            { runId: m.runId, operationId: "approval" },
          );
        else {
          emit(
            mode === "cancel" ? "run.cancelled" : "run.completed",
            mode === "cancel"
              ? { reason: "agent stopped" }
              : mode === "missing-output"
                ? {}
                : { output: null },
            { runId: m.runId },
          );
          if (mode === "late")
            emit(
              "message.created",
              { role: "assistant", content: "late" },
              { runId: m.runId },
            );
          closed = true;
        }
      }
      if (m.type === "approval.resolve") {
        emit(
          "approval.completed",
          { decision: m.payload.decision },
          { runId: m.runId, operationId: m.operationId },
        );
        emit("run.completed", { output: null }, { runId: m.runId });
        closed = true;
      }
      if (m.type === "tool.mock")
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
    },
    async close() {
      closed = true;
      wake();
    },
    frames: {
      async *[Symbol.asyncIterator]() {
        while (!closed || queue.length) {
          if (queue.length) yield queue.shift();
          else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
        }
      },
    },
  };
}
