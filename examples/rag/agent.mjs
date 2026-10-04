import { serveAgent } from "../../packages/sdk/dist/index.js";
await serveAgent(async (input, context) => ({
  answer: "Fixture answer",
  citations: await context.callTool("retrieve", input, async () => [
    "fake document",
  ]),
}));
