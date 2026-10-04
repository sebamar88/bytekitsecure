import type { ProtocolMessage } from "./generated.js";
export type Direction = "runner" | "adapter";
const commands = new Set<ProtocolMessage["type"]>([
  "hello",
  "configure",
  "run.start",
  "run.cancel",
  "tool.proceed",
  "tool.mock",
  "tool.reject",
  "approval.resolve",
]);
const responses: Partial<
  Record<ProtocolMessage["type"], readonly ProtocolMessage["type"][]>
> = {
  "adapter.ready": ["hello"],
  "adapter.configured": ["configure"],
  "run.started": ["run.start"],
  "run.cancelled": ["run.cancel"],
  "tool.proceed": ["tool.requested"],
  "tool.mock": ["tool.requested"],
  "tool.reject": ["tool.requested"],
  "approval.resolve": ["approval.requested"],
};
export class ProtocolViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolViolation";
  }
}
export function assertProtocol(
  condition: unknown,
  reason: string,
): asserts condition {
  if (!condition) throw new ProtocolViolation(reason);
}
export function validateDirection(
  message: ProtocolMessage,
  direction: Direction,
): void {
  assertProtocol(
    direction === "runner" || direction === "adapter",
    "Unknown message direction",
  );
  assertProtocol(
    commands.has(message.type) === (direction === "runner"),
    `Wrong direction for ${message.type}`,
  );
}
export function validateCorrelation(
  message: ProtocolMessage,
  messages: ReadonlyMap<string, ProtocolMessage>,
): void {
  const permitted = responses[message.type];
  const correlation =
    "correlationId" in message ? message.correlationId : undefined;
  if (!correlation) {
    assertProtocol(
      !permitted || message.type === "run.cancelled",
      `Missing correlation for ${message.type}`,
    );
    return;
  }
  assertProtocol(permitted, "Unlisted lifecycle event cannot have correlation");
  const trigger = messages.get(correlation);
  assertProtocol(
    trigger && permitted.includes(trigger.type),
    `Invalid trigger for ${message.type}`,
  );
  if ("runId" in message)
    assertProtocol(
      "runId" in trigger && trigger.runId === message.runId,
      "Correlation belongs to a different run",
    );
  if ("operationId" in message)
    assertProtocol(
      "operationId" in trigger && trigger.operationId === message.operationId,
      "Correlation belongs to a different operation",
    );
  if (trigger.type === "tool.requested")
    assertProtocol(
      trigger.payload.intercepted,
      "Only intercepted requests accept decisions",
    );
}
