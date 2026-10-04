import {
  validateScenarioCollection,
  type ScenarioDefinition,
  type CausignConfig,
  type ScenarioResult,
  type Diagnostic,
} from "@causign/protocol";
import { runScenario, type RunOptions } from "./execute.js";
import { suiteExitCode } from "./results.js";
import { prepareScenario } from "./compile.js";
export interface SuiteResult {
  schemaVersion: "1";
  results: ScenarioResult[];
  diagnostics: Diagnostic[];
  exitCode: number;
  interrupted: boolean;
}
export async function runSuite(
  defs: ScenarioDefinition[],
  config: CausignConfig,
  options: RunOptions = {},
): Promise<SuiteResult> {
  validateScenarioCollection(defs);
  for (const def of defs) prepareScenario(def, config);
  const results: ScenarioResult[] = [];
  const diagnostics: Diagnostic[] = [];
  if (!defs.length)
    diagnostics.push({ kind: "configuration-error", message: "Empty suite" });
  for (const def of defs) {
    if (options.signal?.aborted) break;
    results.push(await runScenario(def, config, options));
    if (options.signal?.aborted) break;
  }
  const interrupted = options.signal?.aborted ?? false;
  return {
    schemaVersion: "1",
    results,
    diagnostics,
    exitCode: suiteExitCode(results, interrupted),
    interrupted,
  };
}
