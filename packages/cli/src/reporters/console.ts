import type { SuiteResult } from "@causign/core";
import type { Diagnostic } from "@causign/protocol";
export interface ConsoleOptions {
  verbose?: boolean;
  maxDiagnosticCharacters?: number;
}
export function reportConsole(
  suite: SuiteResult,
  options: ConsoleOptions = {},
): string {
  const lines: string[] = [];
  const bounded = (value: string) => {
    const limit = Math.max(
      0,
      Math.min(options.maxDiagnosticCharacters ?? 2048, 4096),
    );
    return value.length > limit
      ? `${value.slice(0, limit)} [truncated]`
      : value;
  };
  const diagnostic = (d: Diagnostic) => {
    lines.push(
      `  ${d.kind}: ${d.kind === "stderr" ? (options.verbose ? bounded(d.message) : "captured (use --verbose)") : d.message}${d.truncated ? " [truncated]" : ""}${d.messageId ? ` message=${d.messageId}` : ""}${d.operationId ? ` operation=${d.operationId}` : ""}${d.receiveSequence !== undefined ? ` receiveSequence=${d.receiveSequence}` : ""}`,
    );
    if (options.verbose && d.rawFrame !== undefined)
      lines.push(`    rawFrame: ${bounded(d.rawFrame)}`);
  };
  for (const result of suite.results) {
    lines.push(`${result.status} ${result.scenarioId}`);
    if (result.missingCapabilities?.length)
      lines.push(
        `  Missing capabilities: ${result.missingCapabilities.join(", ")}`,
      );
    for (const assertion of result.assertions) {
      lines.push(
        `  ${assertion.status} ${assertion.id}: expected ${assertion.expected}; observed ${assertion.observed}; ${assertion.reason}`,
      );
      for (const evidence of assertion.evidence) {
        lines.push(`    evidence: ${JSON.stringify(evidence)}`);
      }
    }
    result.diagnostics.forEach(diagnostic);
  }
  suite.diagnostics.forEach(diagnostic);
  if (suite.interrupted) lines.push("Interrupted");
  lines.push(`Exit code: ${suite.exitCode}`);
  return lines.join("\n");
}
