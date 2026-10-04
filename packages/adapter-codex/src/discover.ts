import { basename } from "node:path";
import { parse } from "@iarna/toml";
import {
  candidateId,
  type AgentCandidate,
  type Diagnostic,
  type Discoverer,
} from "@causign/runtime";
export const codexDiscoverer: Discoverer = {
  id: "causign/codex-config",
  sourceKinds: ["file"],
  async discover(_source, context) {
    const candidates: AgentCandidate[] = [],
      diagnostics: Diagnostic[] = [],
      selectors = new Set<string>();
    for (const file of context.files) {
      const name = basename(file.path);
      if (name === "config.toml") {
        try {
          const config = parse(file.text);
          if (config.profiles)
            diagnostics.push({
              code: "codex.legacy-profile",
              message:
                "Embedded profiles are not the reference 0.159.0 native profile format; use explicitly selected <name>.config.toml files",
              source: file.path,
              severity: "warning",
            });
        } catch {
          diagnostics.push({
            code: "codex.definition",
            message: "Invalid TOML configuration",
            source: file.path,
            severity: "error",
          });
        }
        continue;
      }
      if (!name.endsWith(".config.toml")) continue;
      try {
        const selector = name.slice(0, -".config.toml".length);
        if (!/^[a-zA-Z0-9_-]+$/.test(selector))
          throw new Error("Invalid native profile selector");
        const config = parse(file.text);
        if (selectors.has(selector))
          throw new Error("Duplicate native profile selector");
        selectors.add(selector);
        for (const key of ["model", "model_provider"])
          if (config[key] !== undefined && typeof config[key] !== "string")
            throw new Error(`Invalid ${key} metadata`);
        candidates.push({
          id: candidateId("causign/codex-config", file.path, selector),
          discovererId: "causign/codex-config",
          name: selector,
          nativeSelector: selector,
          kind: "agent",
          source: { kind: "file", path: file.path },
          revision: file.revision,
          runtimeId: "codex",
          metadata: {
            definitionFormat: "codex-profile-v2",
            ...(config.model ? { model: config.model } : {}),
            ...(config.model_provider
              ? { provider: config.model_provider }
              : {}),
          },
        });
      } catch (error) {
        diagnostics.push({
          code: "codex.definition",
          message: error instanceof Error ? error.message : String(error),
          source: file.path,
          severity: "error",
        });
      }
    }
    return {
      candidates,
      diagnostics,
      complete: !diagnostics.some((item) => item.severity === "error"),
    };
  },
};
