import { agentTest, expect } from "../../packages/sdk/dist/index.js";
export default agentTest("concurrent fake workers", {
  agent: "coordinator",
  input: null,
  mocks: { worker: { result: { fake: true } } },
  assertions: [
    expect.tool("worker").toHaveBeenMocked(),
    expect.tool("worker").not.toHaveBeenExecuted(),
  ],
});
