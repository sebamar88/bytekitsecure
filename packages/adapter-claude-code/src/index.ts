import type { RuntimePlugin } from "@causign/runtime";
import { claudeDiscoverer } from "./discover.js";
import { probeClaude } from "./probe.js";
import { createClaudeLaunch } from "./launch.js";
const plugin: RuntimePlugin = {
  id: "causign/claude-code",
  apiVersion: "1",
  discoverers: [claudeDiscoverer],
  adapters: [
    {
      id: "causign/claude-output",
      supports: (candidate) =>
        candidate.kind === "agent" &&
        candidate.discovererId === "causign/claude-agents",
      probe: probeClaude,
      createLaunch: createClaudeLaunch,
    },
  ],
};
export default plugin;
export * from "./discover.js";
export * from "./probe.js";
export * from "./launch.js";
export * from "./translate.js";
