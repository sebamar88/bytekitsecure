import { it, expect as check } from "vitest";
import { agentTest, expect } from "../../sdk/src/index.js";
import {
  inspectScenario,
  prepareScenario,
  negotiateScenario,
} from "../src/compile.js";
import {
  validateMessage,
  validatePlan,
  type CausignConfig,
} from "@causign/protocol";
import { ready } from "../../protocol/test/fixtures.js";
const config: CausignConfig = {
  schemaVersion: "1",
  agents: { billing: { command: "never-executed", args: [] } },
  evaluators: { judge: { module: "never-imported", options: null } },
};
it("infers mock and assertion requirements before execution", () => {
  const def = agentTest("refund", {
    agent: "billing",
    input: null,
    mocks: { getCustomer: { result: null } },
    assertions: [expect.tool("refund").not.toHaveBeenRequested()],
  });
  check(inspectScenario(def, config).requirements).toEqual(
    check.arrayContaining([
      "intercept.tools",
      "observe.toolRequests",
      "observe.toolResults",
    ]),
  );
  check(inspectScenario(def, config).compatibility).toBe("unverified");
  check(JSON.parse(JSON.stringify(def))).toEqual(def);
});
it("derives requirements from assertion types despite empty supplied requirements", () => {
  const def = agentTest("x", {
    agent: "billing",
    input: null,
    assertions: [
      expect.tool("x").toHaveBeenMocked(),
      expect.output().toSatisfy({ criteria: "ok", evaluator: "judge" }),
      expect.run().toHaveCostLessThan(0),
    ],
    requirements: ["control.approvals"],
  });
  def.assertions.forEach((a) => (a.requirements = []));
  check(prepareScenario(def, config).requirements).toEqual(
    check.arrayContaining([
      "intercept.tools",
      "observe.toolRequests",
      "observe.toolResults",
      "observe.output",
      "observe.cost",
      "control.approvals",
      "observe.approvals",
    ]),
  );
});
it("rejects unresolved agent and evaluator references", () => {
  check(() =>
    prepareScenario(agentTest("x", { agent: "missing", input: null }), config),
  ).toThrow(/agent/i);
  check(() =>
    prepareScenario(
      agentTest("x", {
        agent: "billing",
        input: null,
        assertions: [
          expect.output().toSatisfy({ criteria: "ok", evaluator: "missing" }),
        ],
      }),
      config,
    ),
  ).toThrow(/evaluator/i);
});
it("negotiates validated immutable plans without mutating configuration", () => {
  const def = agentTest("x", {
    agent: "billing",
    input: null,
    timeoutMs: 100,
    assertions: [expect.output().toEqual(null)],
  });
  const prepared = prepareScenario(def, config);
  config.agents.billing.args.push("later");
  const result = negotiateScenario(
    prepared,
    validateMessage(ready(["observe.output"])) as never,
  );
  check(result.status).toBe("READY");
  if (result.status !== "READY") throw Error("not ready");
  check(validatePlan(result.plan)).toMatchObject({
    scenarioId: "x",
    input: null,
    agent: { args: [] },
    limits: { scenarioTimeoutMs: 100 },
  });
  check(result.plan).not.toHaveProperty("runId");
  check(Object.isFrozen(result.plan)).toBe(true);
  check(Object.isFrozen(result.plan.agent.args)).toBe(true);
  check(() => result.plan.agent.args.push("mutation")).toThrow();
  config.agents.billing.args.pop();
});
it("returns incompatibility and handshake errors before emitting a plan", () => {
  const p = prepareScenario(
    agentTest("x", {
      agent: "billing",
      input: null,
      assertions: [expect.output().toEqual(0)],
    }),
    config,
  );
  check(
    negotiateScenario(p, validateMessage(ready([])) as never),
  ).toMatchObject({
    status: "INCOMPATIBLE",
    missingCapabilities: ["observe.output"],
  });
  check(
    negotiateScenario(p, validateMessage(ready(["intercept.tools"])) as never),
  ).toMatchObject({ status: "ERROR" });
  check(negotiateScenario(p, {} as never)).toMatchObject({ status: "ERROR" });
});

it("carries approval configuration and infers control requirements", () => {
  const p = prepareScenario(
    agentTest("approval", {
      agent: "billing",
      input: null,
      approvalDecisions: [
        { decision: "grant", input: null },
        { decision: "reject" },
      ],
    }),
    config,
  );
  check(p.requirements).toEqual(
    check.arrayContaining(["control.approvals", "observe.approvals"]),
  );
  const r = negotiateScenario(
    p,
    validateMessage(ready(["control.approvals", "observe.approvals"])) as never,
  );
  check(r).toMatchObject({
    status: "READY",
    plan: {
      approvalDecisions: [
        { decision: "grant", input: null },
        { decision: "reject" },
      ],
    },
  });
});
it.each([
  [{ decision: "grant" }, { decision: "reject" }],
  [
    { decision: "grant", input: { a: 1, b: 2 } },
    { decision: "reject", input: { b: 2, a: 1 } },
  ],
])("rejects conflicting approval rules %#", (rules) => {
  check(() =>
    prepareScenario(
      agentTest("x", {
        agent: "billing",
        input: null,
        approvalDecisions: rules as never,
      }),
      config,
    ),
  ).toThrow(/approval/i);
});
it("keeps approval observation independent from approval control", () => {
  const p = prepareScenario(
    agentTest("x", {
      agent: "billing",
      input: null,
      assertions: [expect.approval().toHaveBeenRequested()],
    }),
    config,
  );
  check(p.requirements).toEqual(["observe.approvals"]);
  check(
    negotiateScenario(p, validateMessage(ready(["observe.approvals"])) as never)
      .status,
  ).toBe("READY");
});
it("rejects duplicate mock names on direct preparation", () => {
  const def = agentTest("x", {
    agent: "billing",
    input: null,
    mocks: { x: { result: null } },
  });
  def.mocks.push({ ...def.mocks[0] });
  check(() => prepareScenario(def, config)).toThrow(/Duplicate mock/);
});
it("rejects direct scenario input accessors before invoking user code", () => {
  let calls = 0;
  const input = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  const def = agentTest("x", { agent: "billing", input: null });
  def.input = input;
  check(() => prepareScenario(def, config)).toThrow();
  check(calls).toBe(0);
  check(() => inspectScenario(def, config)).toThrow();
  check(calls).toBe(0);
});
it("rejects hidden functions on direct scenario inputs", () => {
  const input = Object.defineProperty({}, "hidden", { value: () => 0 });
  const def = agentTest("x", { agent: "billing", input: null });
  def.input = input;
  check(() => prepareScenario(def, config)).toThrow();
});
it("rejects configuration agent accessors without invoking them", () => {
  let calls = 0;
  const local = {
    schemaVersion: "1",
    agents: {
      billing: Object.defineProperty({}, "command", {
        enumerable: true,
        get() {
          calls++;
          return "fixture";
        },
      }),
    },
    evaluators: {},
  } as CausignConfig;
  Object.defineProperty(local.agents.billing, "args", {
    value: [],
    enumerable: true,
  });
  check(() =>
    prepareScenario(agentTest("x", { agent: "billing", input: null }), local),
  ).toThrow();
  check(calls).toBe(0);
});
it("rejects evaluator option accessors without importing or invoking them", () => {
  let calls = 0;
  const options = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      calls++;
      return null;
    },
  });
  const local: CausignConfig = {
    schemaVersion: "1",
    agents: { billing: { command: "fixture", args: [] } },
    evaluators: { judge: { module: "never-imported", options } },
  };
  const def = agentTest("x", {
    agent: "billing",
    input: null,
    assertions: [
      expect.output().toSatisfy({ criteria: "ok", evaluator: "judge" }),
    ],
  });
  check(() => prepareScenario(def, local)).toThrow();
  check(calls).toBe(0);
});
it("rejects hidden functions in configuration before snapshotting", () => {
  const local: CausignConfig = {
    schemaVersion: "1",
    agents: { billing: { command: "fixture", args: [] } },
    evaluators: {
      judge: {
        module: "never-imported",
        options: Object.defineProperty({}, "hidden", { value: () => 0 }),
      },
    },
  };
  check(() =>
    prepareScenario(agentTest("x", { agent: "billing", input: null }), local),
  ).toThrow();
});
it("preserves valid plain JSON configuration snapshots", () => {
  const local: CausignConfig = {
    schemaVersion: "1",
    agents: {
      billing: { command: "fixture", args: ["literal"], env: { MODE: "test" } },
    },
    evaluators: {
      judge: {
        module: "never-imported",
        options: { threshold: 0, nested: [null, true] },
      },
    },
  };
  const def = agentTest("x", {
    agent: "billing",
    input: { value: 0 },
    assertions: [
      expect.output().toSatisfy({ criteria: "ok", evaluator: "judge" }),
    ],
  });
  const p = prepareScenario(def, local);
  local.agents.billing.env!.MODE = "changed";
  local.evaluators.judge.options = null;
  def.input = null;
  check(p).toMatchObject({
    definition: { input: { value: 0 } },
    agent: { args: ["literal"], env: { MODE: "test" } },
    evaluators: { judge: { options: { threshold: 0, nested: [null, true] } } },
  });
});
