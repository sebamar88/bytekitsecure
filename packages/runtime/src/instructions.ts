import { basename } from "node:path";
import { candidateId } from "./scan.js";
import type { RuntimePlugin } from "./types.js";
export const instructionPlugin: RuntimePlugin = {
  id: "causign/instructions",
  apiVersion: "1",
  adapters: [],
  discoverers: [
    {
      id: "causign/markdown-instructions",
      sourceKinds: ["file"],
      async discover(_source, context) {
        return {
          complete: true,
          diagnostics: [],
          candidates: context.files
            .filter((file) => file.path.toLowerCase().endsWith(".md"))
            .map((file) => ({
              id: candidateId(
                "causign/markdown-instructions",
                file.path,
                "instructions",
              ),
              discovererId: "causign/markdown-instructions",
              kind: "instructions" as const,
              name: basename(file.path),
              source: { kind: "file" as const, path: file.path },
              revision: file.revision,
            })),
        };
      },
    },
  ],
};
