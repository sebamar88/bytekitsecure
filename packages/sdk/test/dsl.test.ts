import { it, expect as check } from "vitest";
import {
  agentTest,
  expect,
  normalizeScenario,
  createScenarioCollector,
} from "../src/index.js";
import { validateScenario } from "@causign/protocol";
it("normalizes static mocks, IDs, null and zero without callbacks", () => {
  const def = agentTest("refund", {
    agent: "billing",
    input: 0,
    mocks: { customer: { result: null }, fail: { error: { code: "no" } } },
    assertions: [expect.output().toEqual(null)],
  });
  check(def.id).toBe("refund");
  check(def.input).toBe(0);
  check(def.mocks).toEqual([
    {
      type: "tool",
      name: "customer",
      response: { kind: "result", value: null },
    },
    {
      type: "tool",
      name: "fail",
      response: { kind: "error", value: { code: "no" } },
    },
  ]);
  check(validateScenario(JSON.parse(JSON.stringify(def)))).toEqual(def);
  check(agentTest("x", { id: "stable", agent: "a", input: null }).id).toBe(
    "stable",
  );
});
it("builds every matcher and negation as schema-valid data", () => {
  const assertions = [
    expect.tool("x").toHaveBeenRequested(),
    expect.tool("x").not.toHaveBeenExecuted(),
    expect.tool("x").toHaveBeenCompleted(),
    expect.tool("x").toHaveBeenMocked(),
    expect.tool("x").toHaveBeenBlocked(),
    expect.approval().toHaveBeenRequested(),
    expect.approval().toHaveBeenGranted(),
    expect.approval().not.toHaveBeenRejected(),
    expect.output().toEqual(null),
    expect.output().toSatisfy({ criteria: "helpful", evaluator: "judge" }),
    expect.run().toHaveLatencyLessThan(100),
    expect.run().toHaveCostLessThan(0),
  ];
  const def = agentTest("x", { agent: "a", input: null, assertions });
  check(validateScenario(def).assertions.map((a) => a.type)).toEqual([
    "tool.requested",
    "tool.executed",
    "tool.completed",
    "tool.mocked",
    "tool.blocked",
    "approval.requested",
    "approval.granted",
    "approval.rejected",
    "output.equal",
    "output.satisfies",
    "run.latencyLessThan",
    "run.costLessThan",
  ]);
  check(def.assertions[1].negated).toBe(true);
  check(new Set(def.assertions.map((a) => a.id)).size).toBe(12);
});
it.each([
  { input: () => 0 },
  { input: undefined },
  { input: NaN },
  { input: new Date() },
  { input: { nested: () => 0 } },
  { input: null, timeoutMs: 0 },
  { input: null, mocks: { x: { result: 0, error: 0 } } },
  {
    input: null,
    mocks: [
      { type: "tool", name: "x", response: { kind: "result", value: 0 } },
      { type: "tool", name: "x", response: { kind: "error", value: 0 } },
    ],
  },
])("rejects invalid serializable definitions %#", (bad) => {
  check(() => agentTest("x", { agent: "a", ...bad } as never)).toThrow();
});
it("normalizes unknown definitions and collects only explicitly", () => {
  const a = agentTest("same", { agent: "a", input: null });
  check(normalizeScenario(a)).toEqual(a);
  const collector = createScenarioCollector();
  check(collector.definitions).toEqual([]);
  collector.add(a);
  check(collector.definitions).toEqual([a]);
  check(() => normalizeScenario({ ...a, extra: true })).toThrow();
  check(() =>
    normalizeScenario({
      ...a,
      assertions: [
        { ...expect.output().toEqual(null), parameters: { value: () => 0 } },
      ],
    }),
  ).toThrow();
});

it("rejects data hidden from JSON serialization and accessors without invoking them", () => {
  const hidden = Object.defineProperty({}, "secret", { value: 1 });
  check(() => agentTest("x", { agent: "a", input: hidden })).toThrow();
  let invoked = false;
  const getter = Object.defineProperty({}, "secret", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  check(() => agentTest("x", { agent: "a", input: getter })).toThrow();
  check(invoked).toBe(false);
});
it("rejects cycles, sparse arrays, and invalid assertion bounds", () => {
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  const sparse: unknown[] = [];
  sparse.length = 2;
  for (const input of [cycle, sparse])
    check(() => agentTest("x", { agent: "a", input } as never)).toThrow();
  for (const assertion of [
    expect.run().toHaveLatencyLessThan(-1),
    expect.run().toHaveCostLessThan(-1),
  ])
    check(() =>
      agentTest("x", { agent: "a", input: null, assertions: [assertion] }),
    ).toThrow();
});
it("rejects arrays with non-JSON custom properties", () => {
  const input: number[] = [];
  Object.defineProperty(input, "hidden", { value: () => 0 });
  check(() => agentTest("x", { agent: "a", input })).toThrow();
  const custom: number[] = [];
  Object.assign(custom, { extra: 1 });
  check(() => agentTest("x", { agent: "a", input: custom })).toThrow();
});
