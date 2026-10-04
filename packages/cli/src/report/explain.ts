import type { JsonValue } from "@causign/protocol";
import type {
  AssertionExplanation,
  JsonDifference,
  ScenarioDetails,
} from "./types.js";
function compare(expected: JsonValue, observed: JsonValue) {
  const differences: JsonDifference[] = [];
  const stack: {
    path: string;
    a?: JsonValue;
    b?: JsonValue;
    hasA: boolean;
    hasB: boolean;
  }[] = [{ path: "", a: expected, b: observed, hasA: true, hasB: true }];
  let truncated = false;
  while (stack.length) {
    const item = stack.pop()!;
    const { a, b, path } = item;
    if (item.hasA && item.hasB && a === b) continue;
    if (
      item.hasA &&
      item.hasB &&
      a !== null &&
      b !== null &&
      typeof a === "object" &&
      typeof b === "object" &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        stack.push({
          path: `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`,
          a: (a as Record<string, JsonValue>)[key],
          b: (b as Record<string, JsonValue>)[key],
          hasA: Object.hasOwn(a, key),
          hasB: Object.hasOwn(b, key),
        });
      }
      continue;
    }
    if (differences.length === 1000) {
      truncated = true;
      break;
    }
    differences.push({
      path: path || "/",
      kind: !item.hasA ? "unexpected" : !item.hasB ? "missing" : "changed",
      ...(item.hasA ? { expected: a } : {}),
      ...(item.hasB ? { observed: b } : {}),
    });
  }
  return { differences, truncated };
}
export function explainAssertion(
  d: ScenarioDetails,
  index: number,
): AssertionExplanation {
  const a = d.result.assertions[index];
  if (!a) throw new Error("Invalid assertion index.");
  const definition = d.plan?.assertions.find(
    (assertion) => assertion.id === a.id,
  );
  const explanation: AssertionExplanation = {
    expected: a.expected,
    observed: a.observed,
    reason: a.reason,
    guidance: "Inspect the recorded reason and linked evidence.",
    differences: [],
    truncated: false,
    evidence: a.evidence.map((reference) => {
      if (reference.kind !== "message") return { reference, available: true };
      const event = d.trace?.events.find(
        (event) =>
          event.message.id === reference.messageId &&
          "runId" in event.message &&
          event.message.runId === d.trace!.runId &&
          (!reference.operationId ||
            ("operationId" in event.message &&
              event.message.operationId === reference.operationId)),
      );
      return {
        reference,
        available: !!event,
        ...(event ? { sequence: event.receiveSequence } : {}),
      };
    }),
  };
  if (d.result.status === "ERROR" || a.status === "ERROR") {
    explanation.guidance =
      "Inspect protocol, adapter, transport, timeout, or evaluator diagnostics. An infrastructure error is not an assertion mismatch.";
    return explanation;
  }
  if (d.result.status === "INCOMPATIBLE") {
    explanation.guidance = `Check adapter capabilities: ${(d.result.missingCapabilities ?? []).join(", ")}. This scenario could not be evaluated.`;
    return explanation;
  }
  if (d.result.status === "SKIP") {
    explanation.guidance =
      "This scenario was skipped. Consult its recorded diagnostics.";
    return explanation;
  }
  if (a.status === "NOT_EVALUATED") {
    explanation.guidance =
      "Insufficient evidence to evaluate this assertion. Absence in an incomplete trace does not prove non-execution.";
    return explanation;
  }
  if (
    definition?.type === "output.equal" &&
    d.trace?.completeness === "complete" &&
    d.trace.terminal?.source === "adapter"
  ) {
    const trace = d.trace;
    const event = trace.events.find(
      (event) =>
        event.message.id === trace.terminal!.messageId &&
        event.message.type === "run.completed" &&
        event.source !== "runner" &&
        "runId" in event.message &&
        event.message.runId === trace.runId,
    );
    if (
      event?.message.type === "run.completed" &&
      Object.hasOwn(event.message.payload, "output")
    ) {
      Object.assign(
        explanation,
        compare(definition.parameters.value, event.message.payload.output!),
      );
      explanation.guidance =
        definition.negated && a.status === "FAIL"
          ? "The output matched the prohibited value. Check whether the expectation or agent behavior should change."
          : explanation.differences.length
            ? "Inspect the differing JSON paths. The recorded verdict determines whether this comparison passed."
            : "The recorded output and expected JSON are structurally equal.";
    }
  } else if (definition?.type.startsWith("tool.")) {
    explanation.guidance = `This assertion checks ${definition.type}. Requested, authorized, started, completed, mocked, and rejected are different facts.${d.trace?.completeness === "incomplete" ? " This trace is incomplete; absence cannot establish non-execution." : ""} Inspect linked lifecycle events.`;
  } else if (definition?.type === "run.latencyLessThan")
    explanation.guidance = `Compare recorded execution latency with the ${definition.parameters.milliseconds} ms threshold. Missing measurements cannot be estimated.`;
  else if (definition?.type === "run.costLessThan")
    explanation.guidance = `Compare recorded cost with the ${definition.parameters.amount} ${definition.parameters.currency} threshold. Missing cost cannot be estimated.`;
  return explanation;
}
