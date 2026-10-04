import { createRequire } from "node:module";
import {
  targetLaunch,
  readVerifiedCandidate,
  type NativeLaunch,
  type Selection,
  type AgentReference,
} from "@causign/runtime";
import { parseClaudeDefinition } from "./discover.js";
import { probeClaude } from "./probe.js";
export async function buildClaudeLaunch(
  selection: Selection,
  prompt: string,
): Promise<NativeLaunch> {
  if (
    selection.adapterId !== "causign/claude-output" ||
    selection.mode !== "output" ||
    selection.candidate.discovererId !== "causign/claude-agents" ||
    selection.candidate.kind !== "agent" ||
    selection.candidate.source.kind !== "file"
  )
    throw new Error("Invalid Claude output selection");
  if (selection.provider)
    throw new Error(
      "Claude provider selection is not implemented; native auth/provider environment applies",
    );
  const { definition } = parseClaudeDefinition(
    await readVerifiedCandidate(selection.candidate),
  );
  if (definition.name !== selection.candidate.nativeSelector)
    throw new Error("Native selector changed");
  const args = [
    "--print",
    "--output-format",
    "json",
    "--restricted",
    "--tools",
    "",
    "--disallowedTools",
    "*",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--setting-sources",
    "",
    "--settings",
    '{"disableAllHooks":true,"enabledPlugins":{}}',
    "--no-session-persistence",
    "--no-chrome",
    "--agents",
    JSON.stringify({
      [definition.name]: {
        description: definition.description,
        prompt: definition.prompt,
        tools: [],
        ...(definition.model ? { model: definition.model } : {}),
      },
    }),
    "--agent",
    definition.name,
  ];
  if (selection.model) args.push("--model", selection.model);
  return targetLaunch(selection.target, "claude", args, prompt);
}
export async function createClaudeLaunch(
  selection: Selection,
): Promise<AgentReference> {
  await buildClaudeLaunch(selection, "");
  const probe = await probeClaude(selection.target);
  if (!probe.capabilities.includes("observe.output"))
    throw new Error(probe.diagnostics.map((item) => item.message).join("; "));
  return {
    command: process.execPath,
    args: [
      createRequire(import.meta.url).resolve(
        "@causign/adapter-claude-code/bin",
      ),
      JSON.stringify(selection),
    ],
    metadata: {
      adapterId: selection.adapterId,
      runtimeVersion: probe.version!,
      candidateId: selection.candidate.id,
      revision: selection.candidate.revision,
      mode: "output",
      ...(selection.model ? { model: selection.model } : {}),
    },
  };
}
