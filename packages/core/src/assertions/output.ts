import {
  validateJsonValue,
  type JsonValue,
  type Trace,
  type ProtocolMessage,
  type EvidenceReference,
} from "@causign/protocol";
export function structuralEqual(left: JsonValue, right: JsonValue): boolean {
  if (left === right) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  )
    return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, i) => structuralEqual(value, right[i]))
    );
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && structuralEqual(left[key], right[key]),
    )
  );
}
export function messageEvidence(message: ProtocolMessage): EvidenceReference {
  return {
    kind: "message",
    messageId: message.id,
    ...("operationId" in message ? { operationId: message.operationId } : {}),
  };
}
export function terminalMessage(trace: Trace): ProtocolMessage | undefined {
  if (trace.terminal?.source !== "adapter") return undefined;
  return trace.events.find(
    (event) =>
      event.message.id === trace.terminal!.messageId &&
      event.message.type === trace.terminal!.type &&
      event.source !== "runner" &&
      "runId" in event.message &&
      event.message.runId === trace.runId,
  )?.message;
}
export type FinalOutput =
  | { status: "available"; value: JsonValue; evidence: EvidenceReference[] }
  | {
      status: "ERROR" | "NOT_EVALUATED";
      reason: string;
      evidence: EvidenceReference[];
    };
export function finalOutput(trace: Trace): FinalOutput {
  const terminal = terminalMessage(trace);
  const evidence = terminal ? [messageEvidence(terminal)] : [];
  if (terminal?.type === "run.completed") {
    if (!Object.hasOwn(terminal.payload, "output"))
      return {
        status: "ERROR",
        reason:
          "Adapter promised final output but omitted it on run.completed.",
        evidence,
      };
    try {
      return {
        status: "available",
        value: validateJsonValue(terminal.payload.output),
        evidence,
      };
    } catch {
      return {
        status: "ERROR",
        reason: "Invalid promised final JSON output.",
        evidence,
      };
    }
  }
  return {
    status: "NOT_EVALUATED",
    reason: "No completed run final output was observed.",
    evidence,
  };
}
