import {
  validateConfig,
  type CausignConfig,
  type AgentReference,
  type EvaluatorConfiguration,
} from "@causign/protocol";
export function resolveConfiguration(
  agent: string,
  evaluatorIds: string[],
  input: CausignConfig,
): {
  agent: AgentReference;
  evaluators: Record<string, EvaluatorConfiguration>;
} {
  const config = validateConfig(input);
  if (!Object.hasOwn(config.agents, agent))
    throw new Error(`Unknown agent reference: ${agent}`);
  const evaluators: Record<string, EvaluatorConfiguration> = {};
  for (const id of evaluatorIds) {
    if (!Object.hasOwn(config.evaluators, id))
      throw new Error(`Unknown evaluator reference: ${id}`);
    Object.defineProperty(evaluators, id, {
      value: structuredClone(config.evaluators[id]),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return { agent: structuredClone(config.agents[agent]), evaluators };
}
