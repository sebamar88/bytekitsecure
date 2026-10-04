import { agentTest, expect } from "../../packages/sdk/dist/index.js";
export default agentTest("structured retrieval", {
  agent: "rag",
  input: "question",
  mocks: { retrieve: { result: ["document:1"] } },
  assertions: [
    expect.tool("retrieve").toHaveBeenMocked(),
    expect
      .output()
      .toSatisfy({ evaluator: "citations", criteria: "has citations" }),
  ],
});
