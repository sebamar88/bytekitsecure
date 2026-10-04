import { fileURLToPath } from "node:url";
import { candidateId, verifyCandidateRevision } from "@causign/runtime";
const supports = (candidate) =>
  candidate.kind === "agent" && candidate.frameworkId === "example";
const probe = async () => ({
  available: true,
  version: "fixture/1",
  capabilities: ["observe.output"],
  diagnostics: [],
});
const createLaunch = async (selection) => {
  if (!supports(selection.candidate))
    throw new Error("Unsupported fixture candidate");
  await verifyCandidateRevision(selection.candidate);
  return {
    command: process.execPath,
    args: [
      fileURLToPath(new URL("./bridge.mjs", import.meta.url)),
      JSON.stringify(selection.candidate),
    ],
  };
};
export default {
  id: "example/framework",
  apiVersion: "1",
  discoverers: [
    {
      id: "example/json-agents",
      sourceKinds: ["file"],
      async discover(_source, context) {
        const candidates = [];
        const diagnostics = [];
        for (const file of context.files) {
          if (!file.path.endsWith("example-agent.json")) continue;
          try {
            const value = JSON.parse(file.text);
            if (
              value.framework !== "example" ||
              typeof value.name !== "string" ||
              typeof value.text !== "string"
            )
              throw Error("Invalid example agent");
            candidates.push({
              id: candidateId("example/json-agents", file.path, value.name),
              discovererId: "example/json-agents",
              name: value.name,
              kind: "agent",
              frameworkId: "example",
              source: { kind: "file", path: file.path },
              revision: file.revision,
            });
          } catch (error) {
            diagnostics.push({
              code: "example.definition",
              severity: "error",
              message: error.message,
              source: file.path,
            });
          }
        }
        return { candidates, diagnostics, complete: diagnostics.length === 0 };
      },
    },
  ],
  adapters: [
    { id: "example/output", supports, probe, createLaunch },
    { id: "example/alternate", supports, probe, createLaunch },
  ],
};
