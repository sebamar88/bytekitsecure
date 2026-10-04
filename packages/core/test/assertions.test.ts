import { it, expect } from "vitest";
import {
  evaluateAssertions,
  type ExecutionMetrics,
} from "../src/assertions/evaluate.js";
import {
  createEvaluatorRegistry,
  type EvaluatorRegistry,
} from "../src/assertions/semantic.js";
import {
  validateMessage,
  type AssertionDefinition,
  type RunPlan,
  type Trace,
  type ProtocolMessage,
} from "@causign/protocol";
import { frame } from "../../protocol/test/fixtures.js";
const caps = [
  "observe.toolRequests",
  "observe.toolExecution",
  "observe.toolResults",
  "intercept.tools",
  "observe.toolRejections",
  "observe.approvals",
  "observe.output",
  "observe.cost",
];
function a(
  type: AssertionDefinition["type"],
  parameters: object = {},
  negated = false,
): AssertionDefinition {
  return {
    id: "a",
    type,
    parameters,
    negated,
    requirements: [],
  } as AssertionDefinition;
}
function message(
  type: string,
  payload: object,
  operationId?: string,
): ProtocolMessage {
  return validateMessage(
    frame(type, {
      id: `m_${type}`,
      payload,
      ...(operationId ? { operationId } : {}),
    }),
  );
}
function t(
  messages: ProtocolMessage[] = [],
  completeness: Trace["completeness"] = "complete",
): Trace {
  if (
    completeness === "complete" &&
    !messages.some((m) =>
      ["run.completed", "run.failed", "run.cancelled", "run.errored"].includes(
        m.type,
      ),
    )
  )
    messages = [
      ...messages,
      message("run.completed", {
        output: null,
        usage: { cost: { amount: 0, currency: "USD" } },
      }),
    ];
  const terminal = messages.find((m) =>
    ["run.completed", "run.failed", "run.cancelled", "run.errored"].includes(
      m.type,
    ),
  );
  return {
    schemaVersion: "1",
    id: "trace",
    runId: "run_1",
    planId: "plan",
    events: messages.map((message, i) => ({
      message,
      receiveSequence: i + 1,
      source: "adapter",
    })),
    diagnostics: [],
    completeness,
    ...(terminal
      ? {
          terminal: {
            type: terminal.type as "run.completed",
            messageId: terminal.id,
            source: "adapter",
          },
        }
      : {}),
  };
}
function plan(assertions: AssertionDefinition[], capabilities = caps): RunPlan {
  return {
    id: "plan",
    scenarioId: "s",
    agent: { command: "fixture", args: [] },
    protocol: "causign/1",
    capabilities,
    input: null,
    requirements: [],
    interceptions: [],
    approvalDecisions: [],
    assertions,
    limits: { scenarioTimeoutMs: 1000 },
  };
}
async function one(
  assertion: AssertionDefinition,
  trace = t(),
  metrics: ExecutionMetrics = {},
  registry: EvaluatorRegistry = {},
) {
  return (
    await evaluateAssertions(plan([assertion]), trace, metrics, registry)
  )[0];
}
it("does not prove absence from incomplete evidence", async () => {
  expect(
    await one(
      a("tool.executed", { name: "delete" }, true),
      t([], "incomplete"),
    ),
  ).toMatchObject({ status: "NOT_EVALUATED" });
  expect(
    await one(
      a("tool.executed", { name: "delete" }, true),
      t([message("tool.started", { name: "delete" }, "op")], "incomplete"),
    ),
  ).toMatchObject({
    status: "FAIL",
    evidence: [{ kind: "message", operationId: "op" }],
  });
});
it.each(["causign", "adapter", "agent", "policy", "external"])(
  "observes a %s block without interception",
  async (source) => {
    expect(
      await one(
        a("tool.blocked", { name: "delete" }),
        t([
          message(
            "tool.rejected",
            { name: "delete", source, reason: "blocked" },
            "op",
          ),
        ]),
      ),
    ).toMatchObject({ status: "PASS" });
  },
);
it.each([
  "tool.requested",
  "tool.executed",
  "tool.completed",
  "tool.mocked",
  "tool.blocked",
  "approval.requested",
  "approval.granted",
  "approval.rejected",
] as const)("uses three way absent evidence for %s", async (type) => {
  const assertion = a(type, type.startsWith("tool.") ? { name: "x" } : {});
  expect((await one(assertion)).status).toBe("FAIL");
  expect((await one({ ...assertion, negated: true })).status).toBe("PASS");
  expect((await one(assertion, t([], "incomplete"))).status).toBe(
    "NOT_EVALUATED",
  );
  expect(
    (await one({ ...assertion, negated: true }, t([], "incomplete"))).status,
  ).toBe("NOT_EVALUATED");
});
it.each([
  [
    "tool.requested",
    "tool.requested",
    { name: "x", input: null, intercepted: false },
  ],
  ["tool.executed", "tool.started", { name: "x" }],
  [
    "tool.completed",
    "tool.completed",
    { name: "x", output: null, execution: "real" },
  ],
  [
    "tool.mocked",
    "tool.completed",
    { name: "x", output: null, execution: "mock" },
  ],
  ["approval.requested", "approval.requested", { input: null }],
  ["approval.granted", "approval.completed", { decision: "grant" }],
  ["approval.rejected", "approval.completed", { decision: "reject" }],
] as const)(
  "observes %s facts even on incomplete traces",
  async (type, event, payload) => {
    const assertion = a(type, type.startsWith("tool.") ? { name: "x" } : {});
    const trace = t([message(event, payload, "op")], "incomplete");
    expect((await one(assertion, trace)).status).toBe("PASS");
    expect((await one({ ...assertion, negated: true }, trace)).status).toBe(
      "FAIL",
    );
  },
);
it("distinguishes real failure, successful mock and mock error", async () => {
  const real = t([
    message("tool.started", { name: "x" }, "op"),
    message(
      "tool.failed",
      { name: "x", error: { message: "fail" }, execution: "real" },
      "op",
    ),
  ]);
  expect((await one(a("tool.executed", { name: "x" }), real)).status).toBe(
    "PASS",
  );
  expect((await one(a("tool.completed", { name: "x" }), real)).status).toBe(
    "FAIL",
  );
  const mock = t([
    message(
      "tool.failed",
      { name: "x", error: { message: "fail" }, execution: "mock" },
      "op",
    ),
  ]);
  expect((await one(a("tool.mocked", { name: "x" }), mock)).status).toBe(
    "FAIL",
  );
  expect(
    (await one(a("tool.executed", { name: "x" }, true), mock)).status,
  ).toBe("PASS");
  expect(
    (
      await one(
        a("tool.completed", { name: "x" }),
        t([
          message(
            "tool.completed",
            { name: "x", output: 0, execution: "mock" },
            "op",
          ),
        ]),
      )
    ).status,
  ).toBe("FAIL");
});
it.each([null, 0, { a: 1, b: [null, 0] }])(
  "compares structural final JSON %j",
  async (value) => {
    expect(
      (
        await one(
          a("output.equal", { value }),
          t([message("run.completed", { output: value })]),
        )
      ).status,
    ).toBe("PASS");
  },
);
it("ignores object key order but retains array order and negation", async () => {
  const trace = t([message("run.completed", { output: { b: 2, a: 1 } })]);
  expect(
    (await one(a("output.equal", { value: { a: 1, b: 2 } }), trace)).status,
  ).toBe("PASS");
  expect(
    (await one(a("output.equal", { value: { a: 1, b: 2 } }, true), trace))
      .status,
  ).toBe("FAIL");
  expect(
    (
      await one(
        a("output.equal", { value: [1, 2] }),
        t([message("run.completed", { output: [2, 1] })]),
      )
    ).status,
  ).toBe("FAIL");
});
it("reports missing promised output as ERROR and interrupted output as insufficient", async () => {
  expect(
    (
      await one(
        a("output.equal", { value: null }),
        t([message("run.completed", {})]),
      )
    ).status,
  ).toBe("ERROR");
  expect(
    (await one(a("output.equal", { value: null }), t([], "incomplete"))).status,
  ).toBe("NOT_EVALUATED");
});
it("requires declared coverage even when supplied assertion requirements are empty", async () => {
  expect(
    (
      await evaluateAssertions(
        plan([a("tool.executed", { name: "x" }, true)], []),
        t(),
        {},
        {},
      )
    )[0].status,
  ).toBe("NOT_EVALUATED");
});
it("uses only completed runner monotonic execution latency", async () => {
  const assertion = a("run.latencyLessThan", { milliseconds: 10 });
  const trace = t([message("run.completed", { output: null })]);
  expect(
    await one(assertion, trace, {
      executionLatencyMs: 5,
      latencyComplete: true,
    }),
  ).toMatchObject({
    status: "PASS",
    evidence: expect.arrayContaining([
      { kind: "metric", metric: "executionLatencyMs", value: 5 },
    ]),
  });
  expect(
    (
      await one(assertion, trace, {
        executionLatencyMs: 10,
        latencyComplete: true,
      })
    ).status,
  ).toBe("FAIL");
  expect(
    (
      await one(assertion, t([], "incomplete"), {
        executionLatencyMs: 5,
        latencyComplete: false,
      })
    ).status,
  ).toBe("NOT_EVALUATED");
  expect((await one(assertion, trace)).status).toBe("ERROR");
});
it.each(["run.completed", "run.failed"])(
  "uses explicit final USD zero on %s",
  async (terminal) => {
    expect(
      (
        await one(
          a("run.costLessThan", { amount: 1, currency: "USD" }),
          t([
            message(terminal, {
              ...(terminal === "run.failed"
                ? { error: { message: "failed" } }
                : { output: null }),
              usage: { cost: { amount: 0, currency: "USD" } },
            }),
          ]),
        )
      ).status,
    ).toBe("PASS");
  },
);
it.each([
  {},
  { usage: { totalTokens: 1 } },
  { usage: { cost: { amount: 1, currency: "EUR" } } },
])("rejects absent or non USD promised aggregate %j", async (payload) => {
  expect(
    (
      await one(
        a("run.costLessThan", { amount: 2, currency: "USD" }),
        t([message("run.completed", { output: null, ...payload })]),
      )
    ).status,
  ).toBe("ERROR");
});
it("never treats partial cost as final on interruption", async () => {
  expect(
    (
      await one(
        a("run.costLessThan", { amount: 2, currency: "USD" }),
        t([], "incomplete"),
      )
    ).status,
  ).toBe("NOT_EVALUATED");
});
const semantic = a("output.satisfies", {
  evaluator: "judge",
  criteria: "zero",
});
const output = t([message("run.completed", { output: 0 })]);
it("records deterministic evaluator identity and raw score without confidence", async () => {
  const registry = await createEvaluatorRegistry(
    {
      judge: {
        module: "fixture",
        options: { threshold: 0 },
        provider: "local",
        model: "fixture",
      },
    },
    async () => ({
      createEvaluator: () => ({
        evaluate: async (value, criteria) => ({
          status: value === 0 && criteria === "zero" ? "PASS" : "FAIL",
          explanation: "deterministic",
          score: 7,
        }),
      }),
    }),
  );
  const result = await one(semantic, output, {}, registry);
  expect(result).toMatchObject({
    status: "PASS",
    reason: "deterministic",
    evidence: expect.arrayContaining([
      {
        kind: "evaluator",
        evaluatorId: "judge",
        configHash: expect.any(String),
        provider: "local",
        model: "fixture",
        score: 7,
      },
    ]),
  });
  expect(
    (await one({ ...semantic, negated: true }, output, {}, registry)).status,
  ).toBe("FAIL");
  expect(result).not.toHaveProperty("confidence");
});
it.each([
  null,
  { status: "PASS" },
  { status: "MAYBE", explanation: "bad" },
  { status: "PASS", explanation: "bad", score: NaN },
])("isolates malformed evaluator verdict %j", async (verdict) => {
  const registry: EvaluatorRegistry = {
    judge: {
      configHash: "hash",
      evaluator: { evaluate: async () => verdict as never },
    },
  };
  const results = await evaluateAssertions(
    plan([semantic, a("output.equal", { value: 0 })]),
    output,
    {},
    registry,
  );
  expect(results.map((r) => r.status)).toEqual(["ERROR", "PASS"]);
});
it("preserves other results when evaluator throws or returns ERROR", async () => {
  for (const evaluator of [
    {
      evaluate: async () => {
        throw Error("offline");
      },
    },
    {
      evaluate: async () => ({
        status: "ERROR" as const,
        explanation: "offline",
      }),
    },
  ]) {
    expect(
      (
        await evaluateAssertions(
          plan([semantic, a("output.equal", { value: 0 })]),
          output,
          {},
          { judge: { configHash: "h", evaluator } },
        )
      ).map((r) => r.status),
    ).toEqual(["ERROR", "PASS"]);
  }
});
it("makes missing evaluator configuration ERROR even without output", async () => {
  expect((await one(semantic, t([], "incomplete"))).status).toBe("ERROR");
});
it("snapshots options and output without allowing evaluator mutation", async () => {
  const config = { judge: { module: "fixture", options: { threshold: 0 } } };
  const registry = await createEvaluatorRegistry(config, async () => ({
    createEvaluator: (options) => ({
      evaluate: async (value) => {
        expect(options).toEqual({ threshold: 0 });
        (value as { x: number }).x = 99;
        return { status: "PASS", explanation: "ok" };
      },
    }),
  }));
  config.judge.options.threshold = 2;
  const trace = t([message("run.completed", { output: { x: 0 } })]);
  await one(semantic, trace, {}, registry);
  expect(trace.events[0].message.payload).toEqual({ output: { x: 0 } });
});
it("rejects evaluator options accessors without running getters", async () => {
  let calls = 0;
  const options = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  await expect(
    createEvaluatorRegistry(
      { judge: { module: "fixture", options } },
      async () => {
        throw Error("should not import");
      },
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
it("references the recorded terminal when proving complete absence", async () => {
  const result = await one(a("tool.executed", { name: "x" }, true));
  expect(result.evidence).toEqual([
    { kind: "message", messageId: "m_run.completed" },
  ]);
});
it("does not count runner commands or another run as observations", async () => {
  const trace = t([message("tool.started", { name: "x" }, "op")]);
  trace.events[0].source = "runner";
  expect((await one(a("tool.executed", { name: "x" }), trace)).status).toBe(
    "FAIL",
  );
  trace.events[0].source = "adapter";
  (trace.events[0].message as { runId: string }).runId = "other";
  expect((await one(a("tool.executed", { name: "x" }), trace)).status).toBe(
    "FAIL",
  );
});
it("retains structural assertions after evaluator attempts output mutation", async () => {
  const trace = t([message("run.completed", { output: { x: 0 } })]);
  const registry: EvaluatorRegistry = {
    judge: {
      configHash: "h",
      evaluator: {
        evaluate: async (value) => {
          (value as { x: number }).x = 99;
          return { status: "PASS", explanation: "ok" };
        },
      },
    },
  };
  expect(
    (
      await evaluateAssertions(
        plan([semantic, a("output.equal", { value: { x: 0 } })]),
        trace,
        {},
        registry,
      )
    ).map((r) => r.status),
  ).toEqual(["PASS", "PASS"]);
});
it("uses strict cost bounds and negation with measured evidence", async () => {
  const trace = t([
    message("run.completed", {
      output: null,
      usage: { cost: { amount: 2, currency: "USD" } },
    }),
  ]);
  expect(
    await one(a("run.costLessThan", { amount: 2, currency: "USD" }), trace),
  ).toMatchObject({
    status: "FAIL",
    evidence: expect.arrayContaining([
      { kind: "metric", metric: "cost", value: 2, currency: "USD" },
    ]),
  });
  expect(
    (
      await one(
        a("run.costLessThan", { amount: 2, currency: "USD" }, true),
        trace,
      )
    ).status,
  ).toBe("PASS");
});
it("does not use timestamps or a synthetic terminal for completed latency", async () => {
  const trace = t(
    [message("run.errored", { error: { message: "disconnect" } })],
    "incomplete",
  );
  trace.terminal!.source = "runner";
  trace.events[0].source = "runner";
  expect(
    (
      await one(a("run.latencyLessThan", { milliseconds: 100 }), trace, {
        executionLatencyMs: 1,
        latencyComplete: true,
      })
    ).status,
  ).toBe("NOT_EVALUATED");
});
it("negates FAIL semantic verdicts but never ERROR verdicts", async () => {
  for (const [status, want] of [
    ["FAIL", "PASS"],
    ["ERROR", "ERROR"],
  ] as const) {
    const registry: EvaluatorRegistry = {
      judge: {
        configHash: "h",
        evaluator: {
          evaluate: async () => ({ status, explanation: "fixture" }),
        },
      },
    };
    expect(
      (await one({ ...semantic, negated: true }, output, {}, registry)).status,
    ).toBe(want);
  }
});
it("checks evaluator module shape at its runtime entrypoint", async () => {
  await expect(
    createEvaluatorRegistry(
      { judge: { module: "fixture" } },
      async () => ({}) as never,
    ),
  ).rejects.toThrow(/createEvaluator/);
  await expect(
    createEvaluatorRegistry({ judge: { module: "fixture" } }, async () => ({
      createEvaluator: () => ({}) as never,
    })),
  ).rejects.toThrow(/evaluate/);
});
it("hashes structural configuration consistently and captures provider model", async () => {
  const load = async () => ({
    createEvaluator: () => ({
      evaluate: async () => ({ status: "PASS" as const, explanation: "ok" }),
    }),
  });
  const left = await createEvaluatorRegistry(
    { judge: { module: "fixture", options: { a: 1, b: 2 } } },
    load,
  );
  const right = await createEvaluatorRegistry(
    { judge: { module: "fixture", options: { b: 2, a: 1 } } },
    load,
  );
  expect(left.judge.configHash).toBe(right.judge.configHash);
  expect(Object.isFrozen(left)).toBe(true);
});
it("rejects an unsupported completeness claim before proving absence", async () => {
  const trace = t();
  trace.events = [];
  expect(
    (await one(a("tool.executed", { name: "x" }, true), trace)).status,
  ).toBe("ERROR");
});
