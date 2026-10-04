import { inspectScenario } from "@causign/core";
import {
  validateScenarioCollection,
  type ScenarioDefinition,
  type CausignConfig,
} from "@causign/protocol";
export function inspectDefinitions(
  definitions: ScenarioDefinition[],
  config: CausignConfig,
) {
  validateScenarioCollection(definitions);
  return definitions.map((definition) => inspectScenario(definition, config));
}
