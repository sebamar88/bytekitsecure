import { MockLanguageModelV4 } from "ai/test";
import { jsonSchema } from "ai";
import { serveAgent } from "@causign/sdk";
import {
  createVercelAdapter,
  vercelBridgeOptions,
} from "@causign/adapter-vercel";
const usage = {
  inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const model = new MockLanguageModelV4({
  doGenerate: [
    {
      content: [
        {
          type: "tool-call",
          toolCallId: "lookup1",
          toolName: "lookup",
          input: '{"query":"example"}',
        },
      ],
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage,
      warnings: [],
    },
    {
      content: [{ type: "text", text: "Example complete" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    },
  ],
});
const tools = {
  lookup: {
    description: "Harmless local example lookup",
    inputSchema: jsonSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }) => ({ query, answer: "local" }),
  },
};
await serveAgent(createVercelAdapter({ model, tools }), vercelBridgeOptions);
