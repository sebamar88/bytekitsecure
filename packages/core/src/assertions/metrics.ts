import type {
  AssertionDefinition,
  AssertionResult,
  EvidenceReference,
  Trace,
} from "@causign/protocol";
import { terminalMessage, messageEvidence } from "./output.js";
/** Runner monotonic duration from sending run.start to receiving its terminal.
 * Excludes handshake/preparation/assertions. Interrupted durations set latencyComplete=false.
 * Cost is read from the adapter terminal, never inferred from tokens or this interface. */
export interface ExecutionMetrics {
  executionLatencyMs?: number;
  latencyComplete?: boolean;
}
export interface MetricVerdict {
  status: AssertionResult["status"];
  reason: string;
  observed: string;
  evidence: EvidenceReference[];
}
export function evaluateMetric(
  assertion: AssertionDefinition,
  trace: Trace,
  metrics: ExecutionMetrics,
): MetricVerdict {
  const terminal = terminalMessage(trace);
  const evidence: EvidenceReference[] = terminal
    ? [messageEvidence(terminal)]
    : [];
  const insufficient = (reason: string): MetricVerdict => ({
    status: "NOT_EVALUATED",
    reason,
    observed: "No complete measurement",
    evidence,
  });
  const error = (reason: string): MetricVerdict => ({
    status: "ERROR",
    reason,
    observed: "Invalid or missing promised measurement",
    evidence,
  });
  if (assertion.type === "run.latencyLessThan") {
    if (
      trace.completeness !== "complete" ||
      !terminal ||
      !["run.completed", "run.failed"].includes(terminal.type)
    )
      return insufficient(
        "Interrupted execution duration does not prove a completed-run latency bound.",
      );
    if (
      metrics.latencyComplete !== true ||
      metrics.executionLatencyMs === undefined ||
      !Number.isFinite(metrics.executionLatencyMs) ||
      metrics.executionLatencyMs < 0
    )
      return error(
        "Missing valid completed runner monotonic execution latency.",
      );
    evidence.push({
      kind: "metric",
      metric: "executionLatencyMs",
      value: metrics.executionLatencyMs,
    });
    const pass = metrics.executionLatencyMs < assertion.parameters.milliseconds;
    return {
      status: pass !== assertion.negated ? "PASS" : "FAIL",
      reason: "Compared completed runner execution latency.",
      observed: `${metrics.executionLatencyMs} ms`,
      evidence,
    };
  }
  if (assertion.type === "run.costLessThan") {
    if (
      !terminal ||
      (terminal.type !== "run.completed" && terminal.type !== "run.failed")
    )
      return insufficient(
        "No final adapter cost aggregate on a completed or failed run.",
      );
    const cost = terminal.payload.usage?.cost;
    if (
      !cost ||
      cost.currency !== "USD" ||
      !Number.isFinite(cost.amount) ||
      cost.amount < 0
    )
      return error(
        "Adapter promised a complete final USD cost aggregate but omitted or invalidated it.",
      );
    if (trace.completeness !== "complete")
      return insufficient(
        "Incomplete trace cannot establish a complete final cost aggregate.",
      );
    evidence.push({
      kind: "metric",
      metric: "cost",
      value: cost.amount,
      currency: "USD",
    });
    return {
      status:
        cost.amount < assertion.parameters.amount !== assertion.negated
          ? "PASS"
          : "FAIL",
      reason: "Compared explicit final adapter USD aggregate.",
      observed: `${cost.amount} USD`,
      evidence,
    };
  }
  return error("Unknown metric matcher.");
}
