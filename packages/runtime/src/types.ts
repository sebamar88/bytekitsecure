import type { AgentReference } from "@causign/protocol";
export type { AgentReference } from "@causign/protocol";
export interface Diagnostic {
  code: string;
  message: string;
  source?: string;
  severity: "warning" | "error";
}
export type DiscoverySource =
  | { kind: "file"; path: string }
  | {
      kind: "service";
      id: string;
      discovererId: string;
      options: Record<string, unknown>;
    };
export interface DiscoveryLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  timeoutMs: number;
}
export interface SourceFile {
  path: string;
  text: string;
  revision: string;
}
export interface DiscoveryContext {
  limits: DiscoveryLimits;
  signal: AbortSignal;
  files: readonly SourceFile[];
}
export interface AgentCandidate {
  id: string;
  discovererId: string;
  name: string;
  description?: string;
  kind: "agent" | "instructions";
  source: { kind: "file"; path: string } | { kind: "service"; id: string };
  revision: string;
  nativeSelector?: string;
  frameworkId?: string;
  runtimeId?: string;
  metadata?: Record<string, unknown>;
  adapterIds?: string[];
}
export interface DiscoveryReport {
  candidates: AgentCandidate[];
  diagnostics: Diagnostic[];
  complete: boolean;
}
export interface Discoverer {
  id: string;
  sourceKinds: readonly DiscoverySource["kind"][];
  discover(
    source: DiscoverySource,
    context: DiscoveryContext,
  ): Promise<DiscoveryReport>;
}
export type ExecutionTarget =
  | { kind: "native"; command?: string; args?: string[]; cwd: string }
  | {
      kind: "wsl";
      distro: string;
      cwd: string;
      command?: string;
      args?: string[];
    };
export interface RuntimeProbe {
  available: boolean;
  version?: string;
  capabilities: string[];
  diagnostics: Diagnostic[];
}
export interface Selection {
  adapterId: string;
  candidate: AgentCandidate;
  target: ExecutionTarget;
  mode: "output";
  model?: string;
  provider?: string;
}
export interface ExecutionAdapter {
  id: string;
  supports(candidate: AgentCandidate): boolean;
  probe(target: ExecutionTarget, selection: Selection): Promise<RuntimeProbe>;
  createLaunch(selection: Selection): Promise<AgentReference>;
}
export interface RuntimePlugin {
  id: string;
  apiVersion: "1";
  discoverers: Discoverer[];
  adapters: ExecutionAdapter[];
}
export interface PluginManifest {
  schemaVersion: "1";
  plugins: string[];
  sources?: Record<
    string,
    { discovererId: string; options: Record<string, unknown> }
  >;
}
export interface Registry {
  readonly plugins: readonly RuntimePlugin[];
  readonly discoverers: readonly Discoverer[];
  readonly adapters: readonly ExecutionAdapter[];
  match(candidate: AgentCandidate): string[];
}
