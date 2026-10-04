import { agentTest, expect } from "@causign/sdk";
export default [
  agentTest("vercel-mock", {
    agent: "vercel",
    input: { prompt: "Look up the example" },
    mocks: { lookup: { result: { answer: "mock" } } },
    assertions: [
      expect.tool("lookup").toHaveBeenMocked(),
      expect.output().toEqual({ text: "Example complete" }),
    ],
  }),
];
