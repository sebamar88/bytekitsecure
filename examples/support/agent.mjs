import { serveAgent } from "../../packages/sdk/dist/index.js";
await serveAgent(async (input, context) => {
  const customer = await context.callTool(
    "customer.lookup",
    input,
    async () => ({ name: "Fake customer" }),
  );
  const approval = await context.requestApproval({
    action: "refund",
    customer,
  });
  return {
    customer,
    approval,
    refund:
      approval === "grant"
        ? await context.callTool("refund", null, async () => ({ fake: true }))
        : null,
  };
});
