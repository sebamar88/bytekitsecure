import {
  validateJsonValue,
  validateScenario,
  validateScenarioCollection,
  type ScenarioDefinition,
  type AssertionDefinition,
  type JsonValue,
} from "@causign/protocol";
import { normalizeMocks, type MockInput } from "./mocks.js";
export type ScenarioInput = Omit<
  ScenarioDefinition,
  | "schemaVersion"
  | "id"
  | "name"
  | "mocks"
  | "assertions"
  | "requirements"
  | "timeoutMs"
> &
  Partial<
    Pick<ScenarioDefinition, "id" | "assertions" | "requirements" | "timeoutMs">
  > & { mocks?: MockInput };
type Kind = AssertionDefinition["type"];
const requirements: Record<Kind, string[]> = {
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
function assertion<K extends Kind>(
  type: K,
  parameters: Extract<AssertionDefinition, { type: K }>["parameters"],
  negated: boolean,
): AssertionDefinition {
  return {
    id: `assertion:${type}`,
    type,
    parameters,
    negated,
    requirements: [...requirements[type]],
  } as AssertionDefinition;
}
function tool(name: string, negated = false) {
  return {
    get not() {
      return tool(name, !negated);
    },
    toHaveBeenRequested: () => assertion("tool.requested", { name }, negated),
    toHaveBeenExecuted: () => assertion("tool.executed", { name }, negated),
    toHaveBeenCompleted: () => assertion("tool.completed", { name }, negated),
    toHaveBeenMocked: () => assertion("tool.mocked", { name }, negated),
    toHaveBeenBlocked: () => assertion("tool.blocked", { name }, negated),
  };
}
function approval(negated = false) {
  return {
    get not() {
      return approval(!negated);
    },
    toHaveBeenRequested: () => assertion("approval.requested", {}, negated),
    toHaveBeenGranted: () => assertion("approval.granted", {}, negated),
    toHaveBeenRejected: () => assertion("approval.rejected", {}, negated),
  };
}
function output(negated = false) {
  return {
    get not() {
      return output(!negated);
    },
    toEqual: (value: JsonValue) =>
      assertion("output.equal", { value }, negated),
    toSatisfy: (
      parameters: Extract<
        AssertionDefinition,
        { type: "output.satisfies" }
      >["parameters"],
    ) => assertion("output.satisfies", parameters, negated),
  };
}
function run(negated = false) {
  return {
    get not() {
      return run(!negated);
    },
    toHaveLatencyLessThan: (milliseconds: number) =>
      assertion("run.latencyLessThan", { milliseconds }, negated),
    toHaveCostLessThan: (amount: number) =>
      assertion("run.costLessThan", { amount, currency: "USD" }, negated),
  };
}
export const expect = { tool, approval, output, run };
export function normalizeScenario(input: unknown): ScenarioDefinition {
  validateJsonValue(input);
  const def = validateScenario(structuredClone(input));
  normalizeMocks(def.mocks);
  const ids = new Set<string>();
  for (const a of def.assertions) {
    if (ids.has(a.id)) throw new Error(`Duplicate assertion ID: ${a.id}`);
    ids.add(a.id);
  }
  return def;
}
export function agentTest(
  name: string,
  definition: ScenarioInput,
): ScenarioDefinition {
  validateJsonValue(definition);
  return normalizeScenario({
    ...definition,
    schemaVersion: "1",
    name,
    id: definition.id ?? name,
    mocks: normalizeMocks(definition.mocks),
    assertions: (definition.assertions ?? []).map((a, index) => ({
      ...a,
      id: `assertion:${index + 1}`,
    })),
    requirements: definition.requirements ?? [],
    timeoutMs: definition.timeoutMs ?? 30000,
  });
}
export function createScenarioCollector() {
  const definitions: ScenarioDefinition[] = [];
  return {
    get definitions() {
      return structuredClone(definitions);
    },
    add(definition: ScenarioDefinition) {
      const candidate = normalizeScenario(definition);
      validateScenarioCollection([...definitions, candidate]);
      definitions.push(candidate);
    },
  };
}
