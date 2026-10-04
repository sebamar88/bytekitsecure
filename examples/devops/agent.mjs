import { serveAgent } from "../../packages/sdk/dist/index.js";
await serveAgent(async (_, context) => {
  try {
    context.rejectTool("deploy", null, {
      source: "policy",
      reason: "Fixture deployment denied",
    });
  } catch {
    return "blocked";
  }
});
