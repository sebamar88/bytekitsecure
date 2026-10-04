import type { AssertionDefinition, ProtocolMessage } from "@causign/protocol";
/** Only recorded lifecycle events count; runner commands are not observations. */
export function matchesTool(
  assertion: AssertionDefinition,
  message: ProtocolMessage,
): boolean {
  if (
    !("name" in assertion.parameters) ||
    !("name" in message.payload) ||
    message.payload.name !== assertion.parameters.name
  )
    return false;
  switch (assertion.type) {
    case "tool.requested":
      return message.type === "tool.requested";
    case "tool.executed":
      return message.type === "tool.started";
    case "tool.completed":
      return (
        message.type === "tool.completed" &&
        message.payload.execution === "real"
      );
    case "tool.mocked":
      return (
        message.type === "tool.completed" &&
        message.payload.execution === "mock"
      );
    case "tool.blocked":
      return message.type === "tool.rejected";
    default:
      return false;
  }
}
