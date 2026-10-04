import { randomUUID } from "node:crypto";
import {
  validateScenario,
  validatePlan,
  negotiate,
  type AssertionDefinition,
  type CausignConfig,
  type AdapterReady,
  type ScenarioDefinition,
  type AgentReference,
  type EvaluatorConfiguration,
  type RunPlan,
  type NegotiationResult,
  type JsonValue,
} from "@causign/protocol";
import { resolveConfiguration } from "./config.js";
import { defaultTransportLimits } from "./transport/process.js";
export interface PreparedScenario {
  definition: ScenarioDefinition;
  agent: AgentReference;
  evaluators: Record<string, EvaluatorConfiguration>;
  requirements: string[];
}
export type NegotiatedScenario =
  | { status: "READY"; plan: RunPlan }
  | Exclude<NegotiationResult, { status: "READY" }>;
export interface Inspection extends PreparedScenario {
  compatibility: "unverified";
}
const matcherRequirements: Record<AssertionDefinition["type"], string[]> = {
  "tool.requested": ["observe.toolRequests"],
  "tool.executed": ["observe.toolExecution"],
  "tool.completed": ["observe.toolResults"],
  "tool.mocked": ["observe.toolResults", "intercept.tools"],
  "tool.blocked": ["observe.toolRejections"],
  "approval.requested": ["observe.approvals"],
  "approval.granted": ["observe.approvals"],
  "approval.rejected": ["observe.approvals"],
  "output.equal": ["observe.output"],
  "output.satisfies": ["observe.output"],
  "run.latencyLessThan": [],
  "run.costLessThan": ["observe.cost"],
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(",")}}`;
}
export function prepareScenario(
  def: ScenarioDefinition,
  config: CausignConfig,
): PreparedScenario {
  const definition = structuredClone(validateScenario(def));
  const mockNames = new Set<string>();
  for (const mock of definition.mocks) {
    if (mockNames.has(mock.name))
      throw new Error(`Duplicate mock name: ${mock.name}`);
    mockNames.add(mock.name);
  }
  const assertionIds = new Set<string>();
  for (const assertion of definition.assertions) {
    if (assertionIds.has(assertion.id))
      throw new Error(`Duplicate assertion ID: ${assertion.id}`);
    assertionIds.add(assertion.id);
  }
  const rules = new Set<string>();
  for (const rule of definition.approvalDecisions ?? []) {
    const key = Object.hasOwn(rule, "input")
      ? `input:${canonical(rule.input!)}`
      : "default";
    if (rules.has(key)) throw new Error("Conflicting duplicate approval rules");
    rules.add(key);
  }
  const ids = definition.assertions.flatMap((a) =>
    a.type === "output.satisfies" ? [a.parameters.evaluator] : [],
  );
  const resolved = resolveConfiguration(definition.agent, ids, config);
  const requirements = new Set(definition.requirements);
  for (const assertion of definition.assertions) {
    for (const r of [
      ...matcherRequirements[assertion.type],
      ...assertion.requirements,
    ])
      requirements.add(r);
    assertion.requirements = [
      ...new Set([
        ...matcherRequirements[assertion.type],
        ...assertion.requirements,
      ]),
    ];
  }
  if (definition.mocks.length) requirements.add("intercept.tools");
  if (definition.approvalDecisions?.length)
    requirements.add("control.approvals");
  if (requirements.has("intercept.tools")) {
    requirements.add("observe.toolRequests");
    requirements.add("observe.toolResults");
  }
  if (requirements.has("control.approvals"))
    requirements.add("observe.approvals");
  return freeze({ definition, ...resolved, requirements: [...requirements] });
}
export function negotiateScenario(
  prepared: PreparedScenario,
  ready: AdapterReady,
): NegotiatedScenario {
  const negotiation = negotiate(ready, prepared.requirements);
  if (negotiation.status !== "READY") return negotiation;
  try {
    const plan = validatePlan({
      id: `plan_${randomUUID()}`,
      scenarioId: prepared.definition.id,
      agent: structuredClone(prepared.agent),
      protocol: negotiation.protocol,
      capabilities: negotiation.capabilities,
      input: structuredClone(prepared.definition.input),
      requirements: [...prepared.requirements],
      interceptions: structuredClone(prepared.definition.mocks),
      approvalDecisions: structuredClone(
        prepared.definition.approvalDecisions ?? [],
      ),
      assertions: structuredClone(prepared.definition.assertions),
      limits: {
        ...defaultTransportLimits,
        scenarioTimeoutMs: prepared.definition.timeoutMs,
      },
    });
    return { status: "READY", plan: freeze(plan) };
  } catch (error) {
    return {
      status: "ERROR",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
export function inspectScenario(
  def: ScenarioDefinition,
  config: CausignConfig,
): Inspection {
  return { ...prepareScenario(def, config), compatibility: "unverified" };
}
