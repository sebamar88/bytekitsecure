import type {
  RunPlan,
  Trace,
  AssertionDefinition,
  AssertionResult,
} from "@causign/protocol";
import { matchesTool } from "./tools.js";
import { matchesApproval } from "./approvals.js";
import {
  finalOutput,
  structuralEqual,
  messageEvidence,
  terminalMessage,
} from "./output.js";
import { evaluateMetric, type ExecutionMetrics } from "./metrics.js";
import { evaluateSemantic, type EvaluatorRegistry } from "./semantic.js";
export type { ExecutionMetrics } from "./metrics.js";
export { createEvaluatorRegistry } from "./semantic.js";
export type {
  Evaluator,
  EvaluatorVerdict,
  EvaluatorRegistry,
  EvaluatorEntry,
  EvaluatorModule,
  EvaluatorModuleLoader,
} from "./semantic.js";
const requirements: Record<AssertionDefinition["type"], string[]> = {
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
export async function evaluateAssertions(
  plan: RunPlan,
  trace: Trace,
  metrics: ExecutionMetrics,
  evaluators: EvaluatorRegistry,
): Promise<AssertionResult[]> {
  const results: AssertionResult[] = [];
  for (const assertion of plan.assertions) {
    const result: AssertionResult = {
      id: assertion.id,
      status: "NOT_EVALUATED",
      expected: `${assertion.negated ? "not " : ""}${assertion.type} ${JSON.stringify(assertion.parameters)}`,
      observed: "No matching fact observed",
      reason: "Insufficient evidence.",
      evidence: [],
    };
    try {
      if (trace.planId !== plan.id)
        throw new Error("Trace plan reference does not match evaluated plan.");
      if (trace.completeness === "complete" && !terminalMessage(trace))
        throw new Error(
          "A complete trace requires a recorded adapter terminal.",
        );
      const entry =
        assertion.type === "output.satisfies" &&
        Object.hasOwn(evaluators, assertion.parameters.evaluator)
          ? evaluators[assertion.parameters.evaluator]
          : undefined;
      if (
        assertion.type === "output.satisfies" &&
        (!entry ||
          typeof entry.configHash !== "string" ||
          !entry.configHash ||
          typeof entry.evaluator?.evaluate !== "function")
      )
        throw new Error(
          `Missing valid evaluator configuration: ${assertion.parameters.evaluator}`,
        );
      const needed = requirements[assertion.type];
      if (!needed) throw new Error("Unknown assertion matcher.");
      const missing = [
        ...new Set([...needed, ...assertion.requirements]),
      ].filter((capability) => !plan.capabilities.includes(capability));
      if (missing.length) {
        result.reason = `Missing required coverage: ${missing.join(", ")}`;
        results.push(result);
        continue;
      }
      if (
        assertion.type === "run.latencyLessThan" ||
        assertion.type === "run.costLessThan"
      )
        Object.assign(result, evaluateMetric(assertion, trace, metrics));
      else if (
        assertion.type === "output.equal" ||
        assertion.type === "output.satisfies"
      ) {
        const output = finalOutput(trace);
        result.evidence = output.evidence;
        if (output.status !== "available") {
          result.status = output.status;
          result.reason = output.reason;
        } else if (assertion.type === "output.equal") {
          result.status =
            structuralEqual(output.value, assertion.parameters.value) !==
            assertion.negated
              ? "PASS"
              : "FAIL";
          result.observed = JSON.stringify(output.value);
          result.reason = "Compared structural final JSON output.";
        } else {
          const verdict = await evaluateSemantic(
            entry!,
            assertion.parameters.evaluator,
            output.value,
            assertion.parameters.criteria,
            assertion.negated,
          );
          result.status = verdict.status;
          result.reason = verdict.reason;
          result.observed = "Configured semantic evaluator verdict";
          result.evidence.push(verdict.evidence);
        }
      } else {
        const matches = trace.events.filter(
          (event) =>
            event.source !== "runner" &&
            "runId" in event.message &&
            event.message.runId === trace.runId &&
            (assertion.type.startsWith("tool.")
              ? matchesTool(assertion, event.message)
              : matchesApproval(assertion, event.message)),
        );
        if (matches.length) {
          result.status = assertion.negated ? "FAIL" : "PASS";
          result.observed = `${matches.length} matching observation(s)`;
          result.reason = "Recorded matching lifecycle evidence.";
          result.evidence = matches.map((event) =>
            messageEvidence(event.message),
          );
        } else if (trace.completeness === "complete") {
          result.status = assertion.negated ? "PASS" : "FAIL";
          result.reason =
            "No matching fact in a complete trace with required coverage.";
          const terminal = terminalMessage(trace);
          result.evidence = terminal ? [messageEvidence(terminal)] : [];
        } else
          result.reason =
            "Absence in an incomplete trace does not prove a claim.";
      }
    } catch (error) {
      result.status = "ERROR";
      result.reason = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
  }
  return results;
}
