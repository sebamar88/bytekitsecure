import { jsonSchema } from "ai";
import type { AgentContext } from "../../sdk/src/index.js";
export const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
export const result = (content: any[], reason = "stop") => ({
  content,
  finishReason: { unified: reason, raw: reason },
  usage,
  warnings: [],
});
export const text = () => result([{ type: "text", text: "done" }]);
export const toolCall = () =>
  result(
    [
      {
        type: "tool-call",
        toolCallId: "call1",
        toolName: "lookup",
        input: '{"query":"x"}',
      },
    ],
    "tool-calls",
  );
export function harness(mock?: unknown) {
  const messages: any[] = [];
  const abort = new AbortController();
  let i = 0;
  const context: AgentContext = {
    signal: abort.signal,
    diagnostic() {},
    requestApproval: async () => {
      throw Error("unsupported");
    },
    rejectTool() {
      throw Error("unsupported");
    },
    message: (p) => messages.push({ type: "message.created", payload: p }),
    modelStarted: (p) => {
      const id = String(++i);
      messages.push({ type: "model.started", id, payload: p });
      return id;
    },
    modelCompleted: (id, p) =>
      messages.push({ type: "model.completed", id, payload: p }),
    modelFailed: (id, e) =>
      messages.push({ type: "model.failed", id, payload: e }),
    reportUsage: (p) => messages.push({ type: "usage", payload: p }),
    async callTool(name, input, execute) {
      messages.push({ type: "tool.requested", input });
      if (mock !== undefined) {
        messages.push({ type: "tool.completed", execution: "mock" });
        return mock as any;
      }
      messages.push({ type: "tool.started" });
      try {
        const output = await execute();
        messages.push({ type: "tool.completed", execution: "real", output });
        return output;
      } catch (e) {
        messages.push({ type: "tool.failed", execution: "real" });
        throw e;
      }
    },
  };
  return { context, messages, abort };
}
export function definitions(real: any) {
  return {
    lookup: {
      description: "Lookup",
      inputSchema: jsonSchema({
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: real,
    },
  };
}
