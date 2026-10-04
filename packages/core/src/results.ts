import type { ScenarioResult, AssertionResult } from "@causign/protocol";
export function scenarioStatus(
  terminal: string | undefined,
  assertions: AssertionResult[],
  error: boolean,
): ScenarioResult["status"] {
  if (
    error ||
    terminal === "run.errored" ||
    terminal === "run.cancelled" ||
    assertions.some((a) => a.status === "ERROR" || a.status === "NOT_EVALUATED")
  )
    return "ERROR";
  return terminal === "run.failed" ||
    assertions.some((a) => a.status === "FAIL")
    ? "FAIL"
    : "PASS";
}
export function suiteExitCode(
  results: ScenarioResult[],
  interrupted = false,
): number {
  if (interrupted) return 130;
  if (!results.length || results.some((r) => r.status === "ERROR")) return 2;
  if (results.some((r) => r.status === "INCOMPATIBLE")) return 3;
  if (results.some((r) => r.status === "FAIL")) return 1;
  return 0;
}
