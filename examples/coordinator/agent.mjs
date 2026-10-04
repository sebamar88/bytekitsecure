import { serveAgent } from "../../packages/sdk/dist/index.js";
await serveAgent(async (_, context) =>
  Promise.all(
    ["research", "review"].map((role) =>
      context.callTool("worker", { role }, async () => ({ role, fake: true })),
    ),
  ),
);
