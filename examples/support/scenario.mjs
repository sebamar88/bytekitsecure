import { agentTest, expect } from "../../packages/sdk/dist/index.js";
export default agentTest("refund approval", {
  agent: "support",
  input: { customerId: "fake" },
  mocks: { "customer.lookup": { result: { name: "Ada" } } },
  approvalDecisions: [{ decision: "reject" }],
  assertions: [
    expect.tool("customer.lookup").toHaveBeenMocked(),
    expect.approval().toHaveBeenRejected(),
    expect.tool("refund").not.toHaveBeenExecuted(),
  ],
});
