import { describe, it, expect } from "vitest";
import {
  validateMessage,
  validatePlan,
  validateScenario,
  validateConfig,
  validateTrace,
  validateResult,
  ContractError,
} from "../src/index.js";
const base = {
  protocol: "causign/1",
  id: "m1",
  timestamp: "2026-09-30T00:00:00Z",
};
const scenario = {
  schemaVersion: "1",
  id: "s1",
  name: "test",
  agent: "local",
  input: null,
  mocks: [],
  assertions: [],
  requirements: [],
  timeoutMs: 1000,
};
const agent = { command: "node", args: [] };
const plan = {
  id: "p1",
  scenarioId: "s1",
  agent,
  protocol: "causign/1",
  capabilities: [],
  input: null,
  requirements: [],
  interceptions: [],
  approvalDecisions: [],
  assertions: [],
  limits: { scenarioTimeoutMs: 1000 },
};
const frames: Record<string, object> = {
  hello: { supportedVersions: ["causign/1"] },
  "adapter.ready": {
    adapter: { name: "fixture", version: "1" },
    supportedVersions: ["causign/1"],
    capabilities: [],
  },
  configure: { protocol: "causign/1" },
  "adapter.configured": {},
  "run.start": {
    input: null,
    interceptions: [],
    approvalDecisions: [],
    limits: { scenarioTimeoutMs: 1000 },
  },
  "run.started": {},
  "run.cancel": { reason: "stop" },
  "run.cancelled": { reason: "stop" },
  "run.completed": {
    output: null,
    usage: { cost: { amount: 0, currency: "USD" } },
  },
  "run.failed": { error: { message: "domain" } },
  "run.errored": { error: { message: "infra" } },
  "tool.requested": { name: "delete", input: null, intercepted: true },
  "tool.proceed": {},
  "tool.mock": { response: { kind: "result", value: null } },
  "tool.reject": { source: "causign", reason: "blocked" },
  "tool.started": { name: "delete" },
  "tool.completed": { name: "delete", output: null, execution: "real" },
  "tool.failed": {
    name: "delete",
    error: { message: "failed" },
    execution: "mock",
  },
  "tool.rejected": { name: "delete", source: "policy", reason: "blocked" },
  "approval.requested": { input: null },
  "approval.resolve": { decision: "reject" },
  "approval.completed": { decision: "reject" },
  "model.started": { model: "fixture" },
  "model.completed": { output: null },
  "model.failed": { error: { message: "failed" } },
  "message.created": { role: "assistant", content: null },
};
function frame(type: string, payload = frames[type]) {
  return {
    ...base,
    type,
    payload,
    ...(type.startsWith("run.") ||
    type.startsWith("tool.") ||
    type.startsWith("approval.") ||
    type.startsWith("model.") ||
    type === "message.created"
      ? { runId: "r1" }
      : {}),
    ...(/^(tool|approval|model)\./.test(type) ? { operationId: "o1" } : {}),
    ...([
      "adapter.ready",
      "adapter.configured",
      "run.started",
      "tool.proceed",
      "tool.mock",
      "tool.reject",
      "approval.resolve",
    ].includes(type)
      ? { correlationId: "trigger" }
      : {}),
  };
}
describe("neutral contracts", () => {
  it("preserves null output and zero cost", () => {
    expect(validateMessage(frame("run.completed")).payload).toEqual({
      output: null,
      usage: { cost: { amount: 0, currency: "USD" } },
    });
  });
  it("rejects plans containing runId", () => {
    expect(() => validatePlan({ ...plan, runId: "r1" })).toThrow(ContractError);
  });
  it.each(Object.keys(frames))("accepts %s variant", (type) =>
    expect(validateMessage(frame(type)).type).toBe(type),
  );
  it("rejects invalid envelopes and handshake run identities", () => {
    for (const value of [
      { ...frame("hello"), runId: "r1" },
      { ...frame("run.started"), correlationId: undefined },
      { ...frame("run.completed"), extra: true },
      { ...frame("hello"), protocol: "causign/2" },
      { ...frame("hello"), timestamp: "yesterday" },
    ])
      expect(() => validateMessage(value)).toThrow(ContractError);
  });
  it("rejects malformed payloads and preserves schema paths", () => {
    try {
      validateMessage(
        frame("tool.mock", {
          response: { kind: "result", value: null, error: "also" },
        }),
      );
      throw new Error("accepted");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractError);
      expect((e as ContractError).schemaPath).toMatch(/\//);
    }
  });
  it("validates scenarios and exclusive static responses", () => {
    expect(validateScenario(scenario).input).toBeNull();
    for (const response of [
      { kind: "result", value: null },
      { kind: "error", value: { message: "fail" } },
    ])
      expect(
        validateScenario({
          ...scenario,
          mocks: [{ type: "tool", name: "lookup", response }],
        }).mocks,
      ).toHaveLength(1);
    expect(() =>
      validateScenario({
        ...scenario,
        mocks: [
          {
            type: "tool",
            name: "lookup",
            response: { kind: "result", value: null, error: "fail" },
          },
        ],
      }),
    ).toThrow();
  });
  it("validates plans configuration and metadata extensions", () => {
    expect(validatePlan(plan).id).toBe("p1");
    expect(
      validateConfig({
        schemaVersion: "1",
        agents: { local: agent },
        evaluators: {},
        metadata: { custom: 1 },
      }).agents.local.command,
    ).toBe("node");
    expect(() =>
      validateConfig({
        schemaVersion: "1",
        agents: { local: { ...agent, unknown: true } },
        evaluators: {},
      }),
    ).toThrow();
  });
  it("validates trace facts and distinct result status sets", () => {
    expect(
      validateTrace({
        schemaVersion: "1",
        id: "t1",
        runId: "r1",
        planId: "p1",
        events: [{ receiveSequence: 1, message: frame("run.completed") }],
        diagnostics: [],
        completeness: "complete",
        terminal: { type: "run.completed", source: "adapter", messageId: "m1" },
      }).completeness,
    ).toBe("complete");
    const result = {
      schemaVersion: "1",
      scenarioId: "s1",
      status: "SKIP",
      assertions: [],
      diagnostics: [],
    };
    expect(validateResult(result).status).toBe("SKIP");
    expect(() =>
      validateResult({ ...result, status: "NOT_EVALUATED" }),
    ).toThrow();
    expect(() =>
      validateResult({
        ...result,
        assertions: [
          {
            id: "a",
            status: "SKIP",
            expected: "x",
            observed: "x",
            reason: "x",
            evidence: [],
          },
        ],
      }),
    ).toThrow();
  });
  it("rejects non JSON values and negative limits", () => {
    for (const input of [
      () => null,
      NaN,
      Infinity,
      undefined,
      new Date(),
      { nested: undefined },
    ])
      expect(() => validateScenario({ ...scenario, input })).toThrow();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => validateScenario({ ...scenario, input: cyclic })).toThrow(
      ContractError,
    );
    expect(() =>
      validatePlan({ ...plan, limits: { scenarioTimeoutMs: 0 } }),
    ).toThrow();
  });
  it("accepts each assertion family and rejects mismatched parameters", () => {
    const variants = [
      ["tool.requested", { name: "delete" }],
      ["tool.executed", { name: "delete" }],
      ["tool.completed", { name: "delete" }],
      ["tool.mocked", { name: "delete" }],
      ["tool.blocked", { name: "delete" }],
      ["approval.requested", {}],
      ["approval.granted", {}],
      ["approval.rejected", {}],
      ["output.equal", { value: null }],
      ["output.satisfies", { evaluator: "judge", criteria: "useful" }],
      ["run.latencyLessThan", { milliseconds: 10 }],
      ["run.costLessThan", { amount: 0, currency: "USD" }],
    ];
    for (const [type, parameters] of variants)
      expect(
        validateScenario({
          ...scenario,
          assertions: [
            { id: "a1", type, parameters, negated: false, requirements: [] },
          ],
        }).assertions,
      ).toHaveLength(1);
    expect(() =>
      validateScenario({
        ...scenario,
        assertions: [
          {
            id: "a1",
            type: "tool.executed",
            parameters: { value: null },
            negated: false,
            requirements: [],
          },
        ],
      }),
    ).toThrow();
  });
});
