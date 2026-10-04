import { PassThrough, Writable } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { serveAgent } from "../src/bridge.js";
import { instrument } from "../src/instrument.js";
function frame(type: string, payload: unknown, extra = {}) {
  return {
    protocol: "causign/1",
    id: `runner-${++sequence}`,
    timestamp: new Date().toISOString(),
    type,
    payload,
    ...extra,
  };
}
let sequence = 0;
async function fixture(
  handler: any,
  selected = true,
  options: any = {},
  approvalDecisions: any[] = [],
) {
  const input = new PassThrough(),
    output = new PassThrough();
  const messages: any[] = [];
  let buffer = "";
  output.on("data", (chunk) => {
    buffer += chunk;
    while (buffer.includes("\n")) {
      const i = buffer.indexOf("\n");
      messages.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const done = serveAgent(handler, {
    input,
    output,
    diagnostics: new PassThrough(),
    ...options,
  });
  const send = (m: any) => input.write(JSON.stringify(m) + "\n");
  const until = async (type: string) => {
    for (let n = 0; n < 100; n++) {
      const m = messages.find((m) => m.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 2));
    }
    throw Error(`Missing ${type}`);
  };
  send(frame("hello", { supportedVersions: ["causign/1"] }));
  await until("adapter.ready");
  send(frame("configure", { protocol: "causign/1" }));
  await until("adapter.configured");
  send(
    frame(
      "run.start",
      {
        input: null,
        interceptions: selected
          ? [
              {
                type: "tool",
                name: "fake",
                response: { kind: "result", value: null },
              },
            ]
          : [],
        approvalDecisions,
        limits: { scenarioTimeoutMs: 1000, interceptionTimeoutMs: 40 },
      },
      { runId: "run" },
    ),
  );
  return {
    send,
    until,
    messages,
    output,
    close: async () => {
      input.end();
      await done;
    },
  };
}
describe("agent bridge", () => {
  it("disconnects when stalled output cannot buffer terminal or fallback", async () => {
    const input = new PassThrough(),
      diagnostics = new PassThrough();
    let diagnostic = "";
    diagnostics.on("data", (chunk) => {
      diagnostic += chunk;
    });
    const output = new Writable({
      write(_chunk, _encoding, _callback) {
        /* Deliberately stalled transport. */
      },
    });
    let context: any;
    const real = vi.fn(async () => null);
    const done = serveAgent(
      async (_, c) => {
        context = c;
        return "x".repeat(2000);
      },
      { input, output, diagnostics, maxBufferedOutputBytes: 800 },
    );
    const send = (type: string, payload: unknown, extra = {}) =>
      input.write(JSON.stringify(frame(type, payload, extra)) + "\n");
    send("hello", { supportedVersions: ["causign/1"] });
    send("configure", { protocol: "causign/1" });
    send(
      "run.start",
      {
        input: null,
        interceptions: [],
        approvalDecisions: [],
        limits: { scenarioTimeoutMs: 50 },
      },
      { runId: "run" },
    );
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 120));
    try {
      expect(settled).toBe(true);
      expect(context.signal.aborted).toBe(true);
      expect(diagnostic).toMatch(/transport|disconnected/i);
      expect(output.listenerCount("error")).toBe(0);
      expect(output.listenerCount("drain")).toBe(0);
      expect(output.listenerCount("close")).toBe(0);
      await expect(context.callTool("late", null, real)).rejects.toThrow(
        "Run closed",
      );
      expect(real).not.toHaveBeenCalled();
    } finally {
      input.end();
      output.destroy();
      await done;
    }
  });
  it("mock bypasses the real function", async () => {
    const real = vi.fn(async () => 1);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const request = await f.until("tool.requested");
    f.send(
      frame(
        "tool.mock",
        { response: { kind: "result", value: null } },
        {
          runId: "run",
          operationId: request.operationId,
          correlationId: request.id,
        },
      ),
    );
    expect((await f.until("run.completed")).payload.output).toBeNull();
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("ignores a late authorization after cancellation", async () => {
    const real = vi.fn(async () => 1);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const request = await f.until("tool.requested");
    f.send(frame("run.cancel", { reason: "stop" }, { runId: "run" }));
    await f.until("run.cancelled");
    f.send(
      frame(
        "tool.proceed",
        {},
        {
          runId: "run",
          operationId: request.operationId,
          correlationId: request.id,
        },
      ),
    );
    await f.close();
    expect(real).not.toHaveBeenCalled();
    expect(
      f.messages.filter(
        (m) => m.type.startsWith("run.") && m.type !== "run.started",
      ),
    ).toHaveLength(1);
  });
  it("nonselected calls execute normally", async () => {
    const real = vi.fn(async () => 2);
    const f = await fixture(
      (_: any, c: any) => c.callTool("fake", null, real),
      false,
    );
    expect((await f.until("run.completed")).payload.output).toBe(2);
    expect(real).toHaveBeenCalledOnce();
    await f.close();
  });
  it("pending decisions time out closed", async () => {
    const real = vi.fn(async () => 2);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    await f.until("run.errored");
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("unconfigured approval errors instead of granting", async () => {
    const f = await fixture((_: any, c: any) => c.requestApproval(null));
    await f.until("approval.requested");
    await f.until("run.errored");
    await f.close();
  });
  it("proceed is explicit and causal", async () => {
    const real = vi.fn(async () => 3);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const r = await f.until("tool.requested");
    expect(real).not.toHaveBeenCalled();
    f.send(
      frame(
        "tool.proceed",
        {},
        { runId: "run", operationId: r.operationId, correlationId: r.id },
      ),
    );
    await f.until("run.completed");
    expect(real).toHaveBeenCalledOnce();
    expect(f.messages.map((m) => m.type).slice(-3)).toEqual([
      "tool.started",
      "tool.completed",
      "run.completed",
    ]);
    await f.close();
  });
  it("mock errors bypass real execution", async () => {
    const real = vi.fn(async () => 3);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const r = await f.until("tool.requested");
    f.send(
      frame(
        "tool.mock",
        { response: { kind: "error", value: { code: "fake" } } },
        { runId: "run", operationId: r.operationId, correlationId: r.id },
      ),
    );
    expect((await f.until("tool.failed")).payload.execution).toBe("mock");
    await f.until("run.failed");
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("reject reports its source without execution", async () => {
    const real = vi.fn(async () => 3);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const r = await f.until("tool.requested");
    f.send(
      frame(
        "tool.reject",
        { source: "policy", reason: "fake policy" },
        { runId: "run", operationId: r.operationId, correlationId: r.id },
      ),
    );
    expect((await f.until("tool.rejected")).payload.source).toBe("policy");
    await f.until("run.failed");
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("disconnect closes a pending intercepted call", async () => {
    const real = vi.fn(async () => 3);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    await f.until("tool.requested");
    await f.close();
    expect(real).not.toHaveBeenCalled();
    expect(f.messages.some((m) => m.type === "run.completed")).toBe(false);
  });
  it("routes concurrent out of order decisions by operation", async () => {
    const real = vi.fn(async () => 0);
    const f = await fixture((_: any, c: any) =>
      Promise.all([
        c.callTool("fake", "a", real),
        c.callTool("fake", "b", real),
      ]),
    );
    await f.until("tool.requested");
    while (f.messages.filter((m) => m.type === "tool.requested").length < 2)
      await new Promise((r) => setTimeout(r, 1));
    const requests = f.messages.filter((m) => m.type === "tool.requested");
    expect(new Set(requests.map((m) => m.operationId)).size).toBe(2);
    for (const r of [...requests].reverse())
      f.send(
        frame(
          "tool.mock",
          { response: { kind: "result", value: r.payload.input } },
          { runId: "run", operationId: r.operationId, correlationId: r.id },
        ),
      );
    expect((await f.until("run.completed")).payload.output).toEqual(["a", "b"]);
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("invalid correlation fails closed", async () => {
    const real = vi.fn(async () => 3);
    const f = await fixture((_: any, c: any) => c.callTool("fake", null, real));
    const r = await f.until("tool.requested");
    f.send(
      frame(
        "tool.proceed",
        {},
        { runId: "run", operationId: r.operationId, correlationId: "unknown" },
      ),
    );
    await f.until("run.errored");
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("output disconnect closes pending decisions and resources", async () => {
    const real = vi.fn(async () => 3);
    let signal: AbortSignal;
    const f = await fixture((_: any, c: any) => {
      signal = c.signal;
      return c.callTool("fake", null, real);
    });
    await f.until("tool.requested");
    f.output.destroy(new Error("fake EPIPE"));
    await new Promise((r) => setTimeout(r, 1));
    await f.close();
    expect(real).not.toHaveBeenCalled();
    expect(signal!.aborted).toBe(true);
  });
  it("observe only approval uses local callback", async () => {
    const f = await fixture(
      (_: any, c: any) => c.requestApproval(null),
      false,
      { controlApprovals: false, approval: async () => "reject" },
    );
    expect((await f.until("adapter.ready")).payload.capabilities).not.toContain(
      "control.approvals",
    );
    expect((await f.until("run.completed")).payload.output).toBe("reject");
    await f.close();
  });
  it("controlled approval dispatches the matching resolution", async () => {
    const f = await fixture(
      (_: any, c: any) => c.requestApproval(null),
      false,
      {},
      [{ decision: "grant" }],
    );
    const r = await f.until("approval.requested");
    f.send(
      frame(
        "approval.resolve",
        { decision: "grant" },
        { runId: "run", operationId: r.operationId, correlationId: r.id },
      ),
    );
    expect((await f.until("run.completed")).payload.output).toBe("grant");
    await f.close();
  });
  it("model message and usage hooks are opt in and validated", async () => {
    const f = await fixture(
      async (_: any, c: any) => {
        c.message({ role: "assistant", content: "fake" });
        const op = c.modelStarted({ model: "fake" });
        c.modelCompleted(op, { output: null });
        c.reportUsage({ inputTokens: 1, totalTokens: 1 });
        return null;
      },
      false,
      {
        observations: [
          "observe.messages",
          "observe.modelCalls",
          "observe.usage",
        ],
      },
    );
    expect((await f.until("run.completed")).payload.usage.totalTokens).toBe(1);
    expect(f.messages.filter((m) => m.type.startsWith("model."))).toHaveLength(
      2,
    );
    await f.close();
  });
  it("rejects invalid usage before storing it", async () => {
    const f = await fixture(
      async (_: any, c: any) => {
        c.reportUsage({ totalTokens: -1 });
        return null;
      },
      false,
      { observations: ["observe.usage"] },
    );
    await f.until("run.failed");
    await f.close();
  });
  it("local policy rejection reports intent without execution", async () => {
    const f = await fixture(async (_: any, c: any) => {
      try {
        c.rejectTool("fake", null, { source: "policy", reason: "denied" });
      } catch {
        return "blocked";
      }
    }, false);
    expect((await f.until("tool.rejected")).payload.source).toBe("policy");
    await f.until("run.completed");
    expect(f.messages.some((m) => m.type === "tool.started")).toBe(false);
    await f.close();
  });
  it("selected local rejection fails closed without inventing a decision", async () => {
    const f = await fixture(async (_: any, c: any) =>
      c.rejectTool("fake", null, { source: "policy", reason: "denied" }),
    );
    await f.until("run.failed");
    expect(f.messages.some((m) => m.type === "tool.rejected")).toBe(false);
    await f.close();
  });
  it("cancellation suppresses late real results and handler completion", async () => {
    let resolve!: (v: number) => void;
    const f = await fixture(
      (_: any, c: any) =>
        c.callTool(
          "fake",
          null,
          () =>
            new Promise((r) => {
              resolve = r;
            }),
        ),
      false,
    );
    await f.until("tool.started");
    f.send(frame("run.cancel", { reason: "stop" }, { runId: "run" }));
    await f.until("run.cancelled");
    resolve(4);
    await new Promise((r) => setTimeout(r, 2));
    await f.close();
    expect(
      f.messages.some(
        (m) => m.type === "tool.completed" || m.type === "run.completed",
      ),
    ).toBe(false);
  });
  it("instrument wraps custom functions through the context", async () => {
    const real = vi.fn(async () => 4);
    const f = await fixture((_: any, c: any) =>
      instrument(c, "fake", real)(null),
    );
    const r = await f.until("tool.requested");
    f.send(
      frame(
        "tool.mock",
        { response: { kind: "result", value: 8 } },
        { runId: "run", operationId: r.operationId, correlationId: r.id },
      ),
    );
    expect((await f.until("run.completed")).payload.output).toBe(8);
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("descriptor guard rejects accessors without executing them", async () => {
    const getter = vi.fn(() => null);
    const value = Object.defineProperty({}, "secret", {
      enumerable: true,
      get: getter,
    });
    const real = vi.fn(async () => null);
    const f = await fixture((_: any, c: any) =>
      c.callTool("fake", value, real),
    );
    await f.until("run.failed");
    expect(getter).not.toHaveBeenCalled();
    expect(real).not.toHaveBeenCalled();
    await f.close();
  });
  it("default capabilities make no message model usage or cost promises", async () => {
    const f = await fixture(async () => null, false);
    const caps = (await f.until("adapter.ready")).payload.capabilities;
    for (const cap of [
      "observe.messages",
      "observe.modelCalls",
      "observe.usage",
      "observe.cost",
    ])
      expect(caps).not.toContain(cap);
    await f.until("run.completed");
    await f.close();
    expect(f.output.listenerCount("error")).toBe(0);
    expect(f.output.listenerCount("drain")).toBe(0);
  });
});
