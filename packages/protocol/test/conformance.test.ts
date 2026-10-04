import { describe, it, expect } from "vitest";
import { negotiate } from "../src/capabilities.js";
import { ProtocolSession } from "../src/lifecycle.js";
import type { AdapterReady, ProtocolMessage } from "../src/generated.js";
let sequence = 0;
function frame(
  type: string,
  payload: unknown = {},
  fields: Record<string, string> = {},
): ProtocolMessage {
  return {
    protocol: "causign/1",
    id: `msg_${++sequence}`,
    timestamp: "2026-09-30T00:00:00Z",
    type,
    payload,
    ...fields,
  } as ProtocolMessage;
}
function ready(capabilities: string[], versions = ["causign/1"]): AdapterReady {
  return frame(
    "adapter.ready",
    {
      adapter: { name: "fixture", version: "1" },
      supportedVersions: versions,
      capabilities,
    },
    { correlationId: "hello" },
  ) as AdapterReady;
}
const all = [
  "intercept.tools",
  "observe.toolRequests",
  "observe.toolExecution",
  "observe.toolResults",
  "observe.toolRejections",
  "observe.approvals",
  "control.approvals",
  "control.cancel",
  "observe.output",
  "observe.cost",
  "observe.modelCalls",
  "observe.messages",
];
const starts = new WeakMap<ProtocolSession, ProtocolMessage>();
function session(
  caps = all,
  interceptions = true,
  started = true,
): ProtocolSession {
  const s = new ProtocolSession();
  const hello = frame("hello", { supportedVersions: ["causign/1"] });
  s.accept(hello, "runner");
  const r = ready(caps);
  r.correlationId = hello.id;
  s.accept(r, "adapter");
  const config = frame("configure", { protocol: "causign/1" });
  s.accept(config, "runner");
  s.accept(
    frame("adapter.configured", {}, { correlationId: config.id }),
    "adapter",
  );
  const start = frame(
    "run.start",
    {
      input: null,
      interceptions: interceptions
        ? [
            {
              type: "tool",
              name: "lookup",
              response: { kind: "result", value: null },
            },
          ]
        : [],
      approvalDecisions: caps.includes("control.approvals")
        ? [{ decision: "grant" }]
        : [],
      limits: { scenarioTimeoutMs: 1000 },
    },
    { runId: "run_1" },
  );
  s.accept(start, "runner");
  starts.set(s, start);
  if (started)
    s.accept(
      frame("run.started", {}, { runId: "run_1", correlationId: start.id }),
      "adapter",
    );
  return s;
}
function request(
  s: ProtocolSession,
  op = "op_1",
  intercepted = true,
): ProtocolMessage {
  const r = frame(
    "tool.requested",
    { name: "lookup", input: null, intercepted },
    { runId: "run_1", operationId: op },
  );
  s.accept(r, "adapter");
  return r;
}
function decision(
  r: ProtocolMessage,
  type = "tool.proceed",
  payload: unknown = {},
): ProtocolMessage {
  return frame(type, payload, {
    runId: "run_1",
    operationId: "operationId" in r ? r.operationId : "",
    correlationId: r.id,
  });
}
function event(type: string, payload: unknown, op = "op_1"): ProtocolMessage {
  return frame(type, payload, { runId: "run_1", operationId: op });
}
describe("negotiation", () => {
  it("rejects inconsistent capability sets", () =>
    expect(negotiate(ready(["control.approvals"]), [])).toMatchObject({
      status: "ERROR",
    }));
  it("requires interception observation dependencies", () =>
    expect(negotiate(ready(["intercept.tools"]), [])).toMatchObject({
      status: "ERROR",
    }));
  it("treats unknown and absent requirements as unsupported", () =>
    expect(
      negotiate(ready(["future.magic"]), ["future.magic", "observe.output"]),
    ).toMatchObject({
      status: "INCOMPATIBLE",
      missingCapabilities: ["future.magic", "observe.output"],
    }));
  it("rejects malformed ready before semantic checks", () =>
    expect(
      negotiate({ ...ready([]), payload: {} } as AdapterReady, []),
    ).toMatchObject({ status: "ERROR" }));
  it("reports no common version", () =>
    expect(negotiate(ready([], ["causign/2"]), [])).toMatchObject({
      status: "INCOMPATIBLE",
    }));
  it("negotiates recognized capabilities", () =>
    expect(
      negotiate(ready(["observe.output", "future.magic"]), ["observe.output"]),
    ).toEqual({
      status: "READY",
      protocol: "causign/1",
      capabilities: ["observe.output"],
    }));
});
describe("session conformance", () => {
  it("rejects reactivation after interruption", () => {
    const s = session();
    const r = request(s);
    s.finalizeInterrupted("run_1");
    expect(() => s.accept(decision(r), "runner")).toThrow();
  });
  it("rejects malformed structures first", () =>
    expect(() =>
      new ProtocolSession().accept(frame("hello", {}), "runner"),
    ).toThrow());
  it("rejects wrong directions", () =>
    expect(() =>
      new ProtocolSession().accept(
        frame("hello", { supportedVersions: ["causign/1"] }),
        "adapter",
      ),
    ).toThrow());
  it("rejects duplicate message IDs", () => {
    const s = session();
    const r = request(s);
    expect(() => s.accept(r, "adapter")).toThrow();
  });
  it("requires configure acknowledgement before runs", () => {
    const s = new ProtocolSession();
    expect(() =>
      s.accept(
        frame(
          "run.start",
          {
            input: null,
            interceptions: [],
            approvalDecisions: [],
            limits: { scenarioTimeoutMs: 1 },
          },
          { runId: "r" },
        ),
        "runner",
      ),
    ).toThrow();
  });
  it("rejects valid ID with wrong reply type", () => {
    const s = new ProtocolSession();
    const h = frame("hello", { supportedVersions: ["causign/1"] });
    s.accept(h, "runner");
    expect(() =>
      s.accept(
        frame("adapter.configured", {}, { correlationId: h.id }),
        "adapter",
      ),
    ).toThrow();
  });
  it("rejects duplicate operations", () => {
    const s = session();
    request(s);
    expect(() => request(s)).toThrow();
  });
  it("rejects duplicate decisions", () => {
    const s = session();
    const r = request(s);
    s.accept(decision(r), "runner");
    expect(() => s.accept(decision(r), "runner")).toThrow();
  });
  it("preserves operation ownership in correlation", () => {
    const s = session();
    const r = request(s);
    request(s, "op_2");
    expect(() =>
      s.accept(
        { ...decision(r), operationId: "op_2" } as ProtocolMessage,
        "runner",
      ),
    ).toThrow();
  });
  it("rejects unknown operations", () => {
    const s = session();
    expect(() =>
      s.accept(
        frame(
          "tool.proceed",
          {},
          { runId: "run_1", operationId: "missing", correlationId: "missing" },
        ),
        "runner",
      ),
    ).toThrow();
  });
  it("allows concurrent decisions out of order", () => {
    const s = session();
    const a = request(s),
      b = request(s, "op_2");
    expect(() => {
      s.accept(decision(b), "runner");
      s.accept(decision(a), "runner");
    }).not.toThrow();
  });
  it("never fails open", () => {
    const s = session();
    request(s);
    expect(() =>
      s.accept(event("tool.started", { name: "lookup" }), "adapter"),
    ).toThrow();
  });
  it("allows non-intercepted execution without a decision", () => {
    const s = session(all, false);
    request(s, "op_1", false);
    expect(() =>
      s.accept(event("tool.started", { name: "lookup" }), "adapter"),
    ).not.toThrow();
  });
  it("allows execution and results without requests for partial observation", () => {
    const s = session(["observe.toolExecution", "observe.toolResults"], false);
    expect(() => {
      s.accept(event("tool.started", { name: "lookup" }), "adapter");
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "real",
        }),
        "adapter",
      );
    }).not.toThrow();
  });
  it("requires requests when coverage promises requests", () => {
    const s = session(all, false);
    expect(() =>
      s.accept(event("tool.started", { name: "lookup" }), "adapter"),
    ).toThrow();
  });
  it("requires real start when coverage promises execution", () => {
    const s = session(all, false);
    request(s, "op_1", false);
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "real",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("prevents mock execution starts", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", { response: { kind: "result", value: null } }),
      "runner",
    );
    expect(() =>
      s.accept(event("tool.started", { name: "lookup" }), "adapter"),
    ).toThrow();
  });
  it("requires mock result/error provenance to match decision", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", { response: { kind: "error", value: "bad" } }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "mock",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("allows matching mock completion", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", { response: { kind: "result", value: null } }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "mock",
        }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects terminal operation reactivation", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", { response: { kind: "result", value: null } }),
      "runner",
    );
    s.accept(
      event("tool.completed", {
        name: "lookup",
        output: null,
        execution: "mock",
      }),
      "adapter",
    );
    expect(() =>
      s.accept(event("tool.started", { name: "lookup" }), "adapter"),
    ).toThrow();
  });
  it("rejects post-start rejection", () => {
    const s = session(all, false);
    request(s, "op_1", false);
    s.accept(event("tool.started", { name: "lookup" }), "adapter");
    expect(() =>
      s.accept(
        event("tool.rejected", {
          name: "lookup",
          source: "policy",
          reason: "blocked",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("requires causign rejection evidence", () => {
    const s = session(all, false);
    request(s, "op_1", false);
    expect(() =>
      s.accept(
        event("tool.rejected", {
          name: "lookup",
          source: "causign",
          reason: "blocked",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("requires selected tools to be intercepted", () => {
    const s = session();
    expect(() => request(s, "op_1", false)).toThrow();
  });
  it("requires output and final USD cost when promised", () => {
    const s = session();
    expect(() =>
      s.accept(frame("run.completed", {}, { runId: "run_1" }), "adapter"),
    ).toThrow();
  });
  it("rejects wrong currency cost", () => {
    const s = session();
    expect(() =>
      s.accept(
        frame(
          "run.completed",
          { output: null, usage: { cost: { amount: 0, currency: "EUR" } } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("accepts explicit null output and zero cost", () => {
    const s = session();
    expect(() =>
      s.accept(
        frame(
          "run.completed",
          { output: null, usage: { cost: { amount: 0, currency: "USD" } } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("cancellation closes pending decisions while permitting one terminal race winner", () => {
    const s = session();
    const r = request(s);
    const cancel = frame("run.cancel", { reason: "stop" }, { runId: "run_1" });
    s.accept(cancel, "runner");
    expect(() => s.accept(decision(r), "runner")).toThrow();
    s.accept(
      frame(
        "run.completed",
        { output: null, usage: { cost: { amount: 0, currency: "USD" } } },
        { runId: "run_1" },
      ),
      "adapter",
    );
    expect(() =>
      s.accept(
        frame(
          "run.cancelled",
          { reason: "stop" },
          { runId: "run_1", correlationId: cancel.id },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("rejects unresolved promised tool results on complete run", () => {
    const s = session(all, false);
    request(s, "op_1", false);
    expect(() =>
      s.accept(
        frame(
          "run.completed",
          { output: null, usage: { cost: { amount: 0, currency: "USD" } } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("observed approvals need no control capability", () => {
    const s = session(["observe.approvals"], false);
    s.accept(event("approval.requested", { input: null }), "adapter");
    expect(() =>
      s.accept(event("approval.completed", { decision: "grant" }), "adapter"),
    ).not.toThrow();
  });
  it("requires approval resolution to preserve its request", () => {
    const s = session();
    const r = event("approval.requested", { input: null });
    s.accept(r, "adapter");
    s.accept(decision(r, "approval.resolve", { decision: "reject" }), "runner");
    expect(() =>
      s.accept(event("approval.completed", { decision: "grant" }), "adapter"),
    ).toThrow();
  });
  it("rejects events from unadvertised families", () => {
    const s = session(["observe.output"], false);
    expect(() =>
      s.accept(event("model.started", { model: "fake" }), "adapter"),
    ).toThrow();
  });
  it("does not consume IDs or decisions on rejected frames", () => {
    const s = session();
    const r = request(s),
      wrong = decision(r);
    wrong.runId = "unknown";
    expect(() => s.accept(wrong, "runner")).toThrow();
    expect(() =>
      s.accept({ ...wrong, runId: "run_1" }, "runner"),
    ).not.toThrow();
  });
  it("does not poison operation state on invalid outcomes", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", { response: { kind: "result", value: null } }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.failed", {
          name: "lookup",
          error: { message: "bad" },
          execution: "mock",
        }),
        "adapter",
      ),
    ).toThrow();
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "mock",
        }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects cross-run correlations even for reused operation IDs", () => {
    const s = session();
    const r = request(s);
    expect(() =>
      s.accept({ ...decision(r), runId: "run_2" }, "runner"),
    ).toThrow();
  });
  it("rejects extra lifecycle correlation rather than substituting for operation ID", () => {
    const s = session(all, false);
    const r = request(s, "op_1", false);
    expect(() =>
      s.accept(
        {
          ...event("tool.started", { name: "lookup" }),
          correlationId: r.id,
        } as ProtocolMessage,
        "adapter",
      ),
    ).toThrow();
  });
  it("allows results-only observation with no request or start", () => {
    const s = session(["observe.toolResults"], false);
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "real",
        }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects unsolicited mock provenance on results-only adapters", () => {
    const s = session(["observe.toolResults"], false);
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: null,
          execution: "mock",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("allows real failure after explicit proceed", () => {
    const s = session();
    const r = request(s);
    s.accept(decision(r), "runner");
    s.accept(event("tool.started", { name: "lookup" }), "adapter");
    expect(() =>
      s.accept(
        event("tool.failed", {
          name: "lookup",
          error: { message: "bad" },
          execution: "real",
        }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("allows matched runner rejection", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.reject", { source: "causign", reason: "blocked" }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.rejected", {
          name: "lookup",
          source: "causign",
          reason: "blocked",
        }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects mismatched rejection reason", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.reject", { source: "causign", reason: "blocked" }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.rejected", {
          name: "lookup",
          source: "causign",
          reason: "other",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("rejects operation family reuse", () => {
    const s = session();
    request(s);
    expect(() =>
      s.accept(event("approval.requested", { input: null }), "adapter"),
    ).toThrow();
  });
  it("rejects duplicate approval decisions", () => {
    const s = session();
    const r = event("approval.requested", { input: null });
    s.accept(r, "adapter");
    s.accept(decision(r, "approval.resolve", { decision: "grant" }), "runner");
    expect(() =>
      s.accept(
        decision(r, "approval.resolve", { decision: "grant" }),
        "runner",
      ),
    ).toThrow();
  });
  it("rejects unresolved approval on completed run", () => {
    const s = session(["observe.approvals"], false);
    s.accept(event("approval.requested", { input: null }), "adapter");
    expect(() =>
      s.accept(frame("run.completed", {}, { runId: "run_1" }), "adapter"),
    ).toThrow();
  });
  it("requires model starts and forbids duplicate terminals", () => {
    const s = session(["observe.modelCalls"], false);
    expect(() =>
      s.accept(event("model.completed", { output: null }), "adapter"),
    ).toThrow();
    s.accept(event("model.started", { model: "fake" }), "adapter");
    s.accept(event("model.completed", { output: null }), "adapter");
    expect(() =>
      s.accept(event("model.failed", { error: { message: "bad" } }), "adapter"),
    ).toThrow();
  });
  it("allows spontaneous cancellation without cost or correlation", () => {
    const s = session();
    request(s);
    expect(() =>
      s.accept(
        frame("run.cancelled", { reason: "agent stopped" }, { runId: "run_1" }),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects cancellation acknowledgements correlated to run start", () => {
    const s = session();
    expect(() =>
      s.accept(
        frame(
          "run.cancelled",
          { reason: "stop" },
          { runId: "run_1", correlationId: "missing" },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("retains terminal state after a second terminal violation", () => {
    const s = session();
    s.accept(
      frame(
        "run.completed",
        { output: null, usage: { cost: { amount: 0, currency: "USD" } } },
        { runId: "run_1" },
      ),
      "adapter",
    );
    expect(() =>
      s.accept(
        frame(
          "run.errored",
          { error: { message: "late" } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).toThrow();
    expect(() => request(s)).toThrow();
  });
  it("validates mock result matches the supplied value", () => {
    const s = session();
    const r = request(s);
    s.accept(
      decision(r, "tool.mock", {
        response: { kind: "result", value: { answer: 42 } },
      }),
      "runner",
    );
    expect(() =>
      s.accept(
        event("tool.completed", {
          name: "lookup",
          output: { answer: 0 },
          execution: "mock",
        }),
        "adapter",
      ),
    ).toThrow();
  });
  it("allows cancellation before run.started without inventing a started run", () => {
    const s = session(all, true, false);
    const cancel = frame(
      "run.cancel",
      { reason: "setup timeout" },
      { runId: "run_1" },
    );
    expect(() => s.accept(cancel, "runner")).not.toThrow();
    expect(() =>
      s.accept(
        frame(
          "run.cancelled",
          { reason: "setup timeout" },
          { runId: "run_1", correlationId: cancel.id },
        ),
        "adapter",
      ),
    ).not.toThrow();
  });
  it("rejects late run.started after pre-start cancellation", () => {
    const s = session(all, true, false);
    s.accept(
      frame("run.cancel", { reason: "stop" }, { runId: "run_1" }),
      "runner",
    );
    expect(() =>
      s.accept(
        frame(
          "run.started",
          {},
          { runId: "run_1", correlationId: starts.get(s)!.id },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("rejects completion when cancellation preceded run.started", () => {
    const s = session(all, true, false);
    s.accept(
      frame("run.cancel", { reason: "stop" }, { runId: "run_1" }),
      "runner",
    );
    expect(() =>
      s.accept(
        frame(
          "run.completed",
          { output: null, usage: { cost: { amount: 0, currency: "USD" } } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).toThrow();
  });
  it("allows setup error before run.started", () => {
    const s = session(all, true, false);
    expect(() =>
      s.accept(
        frame(
          "run.errored",
          { error: { message: "setup failed" } },
          { runId: "run_1" },
        ),
        "adapter",
      ),
    ).not.toThrow();
  });
});
