import { agentTest, expect } from "../../packages/sdk/dist/index.js";
export default agentTest("fake deployment policy", {
  agent: "devops",
  input: null,
  assertions: [
    expect.tool("deploy").toHaveBeenBlocked(),
    expect.tool("deploy").not.toHaveBeenExecuted(),
  ],
});
