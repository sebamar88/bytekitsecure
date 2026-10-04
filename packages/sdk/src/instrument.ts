import type {
  JsonValue,
  MessageCreated,
  ModelStarted,
  ModelCompleted,
  Usage,
} from "@causign/protocol";
/** Context belongs to one run. Cooperative handlers must honor signal. */
export interface AgentContext {
  readonly signal: AbortSignal;
  callTool(
    name: string,
    input: JsonValue,
    execute: () => Promise<JsonValue>,
  ): Promise<JsonValue>;
  rejectTool(
    name: string,
    input: JsonValue,
    rejection: {
      source: "adapter" | "agent" | "policy" | "external";
      reason: string;
    },
  ): never;
  requestApproval(input: JsonValue): Promise<"grant" | "reject">;
  message(payload: MessageCreated["payload"]): void;
  modelStarted(payload: ModelStarted["payload"]): string;
  modelCompleted(operationId: string, payload: ModelCompleted["payload"]): void;
  modelFailed(operationId: string, error: JsonValue): void;
  reportUsage(usage: Usage): void;
  diagnostic(message: string): void;
}
/** Wrap custom functions explicitly; no global monkey patching. */
export function instrument(
  context: AgentContext,
  name: string,
  execute: (input: JsonValue) => Promise<JsonValue>,
) {
  return (input: JsonValue) =>
    context.callTool(name, input, () => execute(input));
}
