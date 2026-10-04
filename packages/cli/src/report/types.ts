import type { SuiteResult } from "@causign/core";
import type {
  RunPlan,
  Trace,
  ScenarioResult,
  EvidenceReference,
  JsonValue,
} from "@causign/protocol";
export type ReportWarning = string;
export interface ReportSummary {
  id: string;
  label: string;
  timestamp: string | null;
  counts: Record<ScenarioResult["status"], number>;
  exitCode?: number;
  interrupted?: boolean;
  error?: string;
}
export interface LoadedReport {
  id: string;
  suite: SuiteResult;
  warnings: ReportWarning[];
}
export interface ScenarioDetails {
  result: ScenarioResult;
  plan?: RunPlan;
  trace?: Trace;
  warnings: ReportWarning[];
}
export interface JsonDifference {
  path: string;
  kind: "changed" | "missing" | "unexpected";
  expected?: JsonValue;
  observed?: JsonValue;
}
export interface EvidenceLink {
  reference: EvidenceReference;
  available: boolean;
  sequence?: number;
}
export interface AssertionExplanation {
  expected: string;
  observed: string;
  reason: string;
  guidance: string;
  differences: JsonDifference[];
  truncated: boolean;
  evidence: EvidenceLink[];
}
export interface ReportRepository {
  list(): Promise<{ reports: ReportSummary[]; warnings: ReportWarning[] }>;
  load(id: string): Promise<LoadedReport>;
  scenario(id: string, index: number): Promise<ScenarioDetails>;
}
