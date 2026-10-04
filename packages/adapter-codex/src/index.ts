import type { RuntimePlugin } from "@causign/runtime";
import { codexDiscoverer } from "./discover.js";
import { probeCodex } from "./probe.js";
import { createCodexLaunch } from "./launch.js";
const plugin: RuntimePlugin = {
  id: "causign/codex",
  apiVersion: "1",
  discoverers: [codexDiscoverer],
  adapters: [
    {
      id: "causign/codex-output",
      supports: (candidate) =>
        candidate.kind === "agent" &&
        candidate.discovererId === "causign/codex-config",
      probe: probeCodex,
      createLaunch: createCodexLaunch,
    },
  ],
};
export default plugin;
export * from "./discover.js";
export * from "./probe.js";
export * from "./launch.js";
export * from "./translate.js";
