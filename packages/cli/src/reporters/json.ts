import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SuiteResult } from "@causign/core";
import {
  validatePlan,
  validateTrace,
  validateResult,
  type RunPlan,
  type Trace,
} from "@causign/protocol";
export interface CapturedArtifacts {
  plans: Map<string, RunPlan>;
  traces: Map<string, Trace>;
}
export interface ArtifactPaths {
  results: string;
  plans: Record<string, string>;
  traces: Record<string, string>;
}
// Names are derived from collection indexes, never untrusted IDs used as paths.
export function artifactPaths(
  suite: SuiteResult,
  directory: string,
): ArtifactPaths {
  const paths: ArtifactPaths = {
    results: resolve(directory, "results.json"),
    plans: {},
    traces: {},
  };
  suite.results.forEach((result, index) => {
    if (result.planId)
      Object.defineProperty(paths.plans, result.planId, {
        value: resolve(directory, `plan-${index + 1}.json`),
        enumerable: true,
      });
    if (result.traceId)
      Object.defineProperty(paths.traces, result.traceId, {
        value: resolve(directory, `trace-${index + 1}.json`),
        enumerable: true,
      });
  });
  return paths;
}
export async function writeArtifacts(
  suite: SuiteResult,
  directory: string,
  captured?: CapturedArtifacts,
): Promise<void> {
  await mkdir(directory, { recursive: true });
  const paths = artifactPaths(suite, directory);
  for (const result of suite.results) {
    validateResult(result);
    if (result.planId && captured) {
      const plan = captured.plans.get(result.planId);
      if (!plan) throw new Error(`Missing captured plan ${result.planId}`);
      validatePlan(plan);
      await writeFile(
        paths.plans[result.planId],
        JSON.stringify({ schemaVersion: "1", plan }, null, 2) + "\n",
        { flag: "wx" },
      );
    }
    if (result.traceId && captured) {
      const trace = captured.traces.get(result.traceId);
      if (!trace) throw new Error(`Missing captured trace ${result.traceId}`);
      validateTrace(trace);
      await writeFile(
        paths.traces[result.traceId],
        JSON.stringify(trace, null, 2) + "\n",
        { flag: "wx" },
      );
    }
  }
  await writeFile(
    paths.results,
    JSON.stringify(
      {
        ...suite,
        artifacts: captured
          ? paths
          : { results: paths.results, plans: {}, traces: {} },
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
}
