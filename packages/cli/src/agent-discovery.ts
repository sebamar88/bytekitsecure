import { resolve } from "node:path";
import {
  createRegistry,
  discoverAgents,
  instructionPlugin,
  loadPluginManifest,
  readPluginManifest,
  type DiscoverySource,
  type RuntimePlugin,
} from "@causign/runtime";
import type { CliIO } from "./main.js";
import claudePlugin from "@causign/adapter-claude-code";
import codexPlugin from "@causign/adapter-codex";
export const builtinPlugins: RuntimePlugin[] = [
  instructionPlugin,
  claudePlugin,
  codexPlugin,
];
export async function discoverCommand(
  args: string[],
  io: CliIO,
): Promise<number> {
  let path: string | undefined,
    sourceId: string | undefined,
    manifestPath: string | undefined,
    discovererId: string | undefined,
    json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!["--path", "--source", "--plugins", "--discoverer"].includes(arg))
      throw new Error(`Unknown discover option: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${arg}`);
    if (arg === "--path") {
      if (path !== undefined) throw new Error("Duplicate --path");
      path = value;
    } else if (arg === "--source") {
      if (sourceId !== undefined) throw new Error("Duplicate --source");
      sourceId = value;
    } else if (arg === "--plugins") manifestPath = value;
    else discovererId = value;
  }
  if ((path !== undefined) === (sourceId !== undefined))
    throw new Error("discover requires exactly one --path or --source");
  const cwd = resolve(io.cwd ?? process.cwd()),
    manifest = manifestPath ? resolve(cwd, manifestPath) : undefined;
  const registry = createRegistry([
    ...builtinPlugins,
    ...(manifest ? await loadPluginManifest(manifest) : []),
  ]);
  let source: DiscoverySource;
  if (path !== undefined) source = { kind: "file", path: resolve(cwd, path) };
  else {
    if (!manifest) throw new Error("--source requires --plugins manifest");
    const configured = (await readPluginManifest(manifest)).sources?.[
      sourceId!
    ];
    if (!configured) throw new Error(`Unknown configured source: ${sourceId}`);
    source = { kind: "service", id: sourceId!, ...configured };
  }
  const report = await discoverAgents(registry, source, {
    discovererId,
    signal: io.signal,
  });
  if (json) io.stdout(JSON.stringify(report, null, 2));
  else {
    io.stdout(
      report.candidates.length
        ? report.candidates
            .map(
              (candidate) =>
                `${candidate.name} [${candidate.kind}]\n  ID: ${candidate.id}\n  Discoverer: ${candidate.discovererId}\n  Adapters: ${candidate.adapterIds?.join(", ") || "unresolved"}\n  Source: ${candidate.source.kind === "file" ? candidate.source.path : candidate.source.id}`,
            )
            .join("\n")
        : "No recognized candidates.",
    );
    for (const diagnostic of report.diagnostics)
      io.stderr(
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
      );
  }
  return io.signal?.aborted
    ? 130
    : !report.complete ||
        report.diagnostics.some((item) => item.severity === "error")
      ? 2
      : 0;
}
