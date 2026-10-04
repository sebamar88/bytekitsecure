import { parseDocument } from "yaml";
import {
  candidateId,
  type AgentCandidate,
  type Diagnostic,
  type Discoverer,
} from "@causign/runtime";
export interface ClaudeDefinition {
  name: string;
  description: string;
  prompt: string;
  model?: string;
}
export function parseClaudeDefinition(text: string): {
  definition: ClaudeDefinition;
  unknown: string[];
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) throw new Error("Missing YAML frontmatter");
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw new Error("Invalid YAML frontmatter");
  const fields = doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown>;
  if (
    !fields ||
    typeof fields !== "object" ||
    Array.isArray(fields) ||
    typeof fields.name !== "string" ||
    !fields.name.trim() ||
    fields.name.startsWith("-") ||
    fields.name.includes(":") ||
    typeof fields.description !== "string" ||
    !fields.description.trim()
  )
    throw new Error("Invalid native agent name or description");
  if (fields.model !== undefined && typeof fields.model !== "string")
    throw new Error("Invalid native model");
  // These fields can cause additional execution and cannot be preserved in an output-only profile.
  if (
    ["hooks", "initialPrompt", "mcpServers", "skills"].some(
      (key) => fields[key] !== undefined,
    )
  )
    throw new Error(
      "Agent requires customization unsupported by output profile",
    );
  return {
    definition: {
      name: fields.name,
      description: fields.description,
      prompt: match[2],
      ...(fields.model && fields.model !== "inherit"
        ? { model: fields.model as string }
        : {}),
    },
    unknown: Object.keys(fields).filter(
      (key) =>
        ![
          "name",
          "description",
          "model",
          "tools",
          "disallowedTools",
          "permissionMode",
        ].includes(key),
    ),
  };
}
export const claudeDiscoverer: Discoverer = {
  id: "causign/claude-agents",
  sourceKinds: ["file"],
  async discover(_source, context) {
    const candidates: AgentCandidate[] = [],
      diagnostics: Diagnostic[] = [],
      selectors = new Set<string>();
    for (const file of context.files) {
      if (
        !file.path.toLowerCase().endsWith(".md") ||
        !file.text.startsWith("---")
      )
        continue;
      try {
        const { definition, unknown } = parseClaudeDefinition(file.text);
        if (selectors.has(definition.name)) {
          diagnostics.push({
            code: "claude.duplicate",
            message: `Duplicate native selector: ${definition.name}`,
            source: file.path,
            severity: "error",
          });
          continue;
        }
        selectors.add(definition.name);
        candidates.push({
          id: candidateId("causign/claude-agents", file.path, definition.name),
          discovererId: "causign/claude-agents",
          name: definition.name,
          description: definition.description,
          kind: "agent",
          nativeSelector: definition.name,
          source: { kind: "file", path: file.path },
          revision: file.revision,
          runtimeId: "claude-code",
          metadata: definition.model ? { model: definition.model } : {},
        });
        if (unknown.length)
          diagnostics.push({
            code: "claude.metadata",
            message: `Metadata not used by output profile: ${unknown.join(", ")}`,
            source: file.path,
            severity: "warning",
          });
      } catch (error) {
        diagnostics.push({
          code: "claude.definition",
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
