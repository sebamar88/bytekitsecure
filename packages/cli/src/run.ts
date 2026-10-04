import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { runSuite, type RunOptions, type SuiteResult } from "@causign/core";
import type { ScenarioDefinition, CausignConfig } from "@causign/protocol";
import {
  artifactPaths,
  writeArtifacts,
  type CapturedArtifacts,
  type ArtifactPaths,
} from "./reporters/json.js";
export async function runDefinitions(
  definitions: ScenarioDefinition[],
  config: CausignConfig,
  outputDirectory: string,
  options: RunOptions = {},
): Promise<{
  suite: SuiteResult;
  paths: ArtifactPaths;
  directory: string;
  artifactsWritten: boolean;
}> {
  const captured: CapturedArtifacts = { plans: new Map(), traces: new Map() };
  const suite = await runSuite(definitions, config, {
    ...options,
    onPlan: async (plan) => {
      captured.plans.set(plan.id, structuredClone(plan));
      await options.onPlan?.(structuredClone(plan));
    },
    onTrace: async (trace) => {
      captured.traces.set(trace.id, structuredClone(trace));
      await options.onTrace?.(structuredClone(trace));
    },
  });
  const directory = resolve(
    outputDirectory,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  );
  let artifactsWritten = false;
  try {
    await writeArtifacts(suite, directory, captured);
    artifactsWritten = true;
  } catch (error) {
    suite.diagnostics.push({
      kind: "artifact-error",
      message: error instanceof Error ? error.message : String(error),
    });
    suite.exitCode = suite.interrupted ? 130 : 2;
  }
  return {
    suite,
    paths: artifactPaths(suite, directory),
    directory,
    artifactsWritten,
  };
}
