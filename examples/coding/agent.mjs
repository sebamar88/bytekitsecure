import { serveAgent } from "../../packages/sdk/dist/index.js";
await serveAgent(async (input, context) => {
  try {
    context.rejectTool("filesystem.delete", input, {
      source: "policy",
      reason: "Fixture never deletes files",
    });
  } catch {
    return { blocked: true };
  }
});
