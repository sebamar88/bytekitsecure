import { agentTest, expect } from "../../packages/sdk/dist/index.js";
export default agentTest("fake deletion blocked", {
  agent: "coding",
  input: { path: "fake.txt" },
  assertions: [
    expect.tool("filesystem.delete").toHaveBeenRequested(),
    expect.tool("filesystem.delete").toHaveBeenBlocked(),
    expect.tool("filesystem.delete").not.toHaveBeenExecuted(),
  ],
});
