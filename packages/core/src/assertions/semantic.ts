import { createHash } from "node:crypto";
import {
  validateJsonValue,
  type JsonValue,
  type EvaluatorConfiguration,
  type EvidenceReference,
  type AssertionResult,
} from "@causign/protocol";
export interface EvaluatorVerdict {
  status: "PASS" | "FAIL" | "ERROR";
  explanation: string;
  score?: number;
}
export interface Evaluator {
  evaluate(output: JsonValue, criteria: string): Promise<EvaluatorVerdict>;
}
export interface EvaluatorEntry {
  evaluator: Evaluator;
  configHash: string;
  provider?: string;
  model?: string;
}
export type EvaluatorRegistry = Readonly<Record<string, EvaluatorEntry>>;
/** A configured module exports createEvaluator(options). Runtime alone loads modules;
 * DSL/prepare/inspect must never import them. No provider SDK or live API is required. */
export interface EvaluatorModule {
  createEvaluator(options: JsonValue): Evaluator | Promise<Evaluator>;
}
export type EvaluatorModuleLoader = (
  specifier: string,
) => Promise<EvaluatorModule>;
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
export async function createEvaluatorRegistry(
  configurations: Record<string, EvaluatorConfiguration>,
  load: EvaluatorModuleLoader = async (specifier) =>
    (await import(specifier)) as EvaluatorModule,
): Promise<EvaluatorRegistry> {
  validateJsonValue(configurations);
  const snapshot = structuredClone(configurations);
  const registry: Record<string, EvaluatorEntry> = Object.create(null);
  for (const [id, config] of Object.entries(snapshot)) {
    const module = await load(config.module);
    if (typeof module.createEvaluator !== "function")
      throw new Error(
        `Evaluator ${id} module must export createEvaluator(options).`,
      );
    const evaluator = await module.createEvaluator(
      structuredClone(config.options ?? null),
    );
    if (!evaluator || typeof evaluator.evaluate !== "function")
      throw new Error(
        `Evaluator ${id} must implement evaluate(output, criteria).`,
      );
    registry[id] = Object.freeze({
      evaluator,
      configHash: createHash("sha256")
        .update(canonical(config as unknown as JsonValue))
        .digest("hex"),
      ...(config.provider ? { provider: config.provider } : {}),
      ...(config.model ? { model: config.model } : {}),
    });
  }
  return Object.freeze(registry);
}
export async function evaluateSemantic(
  entry: EvaluatorEntry,
  id: string,
  output: JsonValue,
  criteria: string,
  negated: boolean,
): Promise<{
  status: AssertionResult["status"];
  reason: string;
  evidence: EvidenceReference;
}> {
  const evidence: EvidenceReference = {
    kind: "evaluator",
    evaluatorId: id,
    configHash: entry.configHash,
    ...(entry.provider ? { provider: entry.provider } : {}),
    ...(entry.model ? { model: entry.model } : {}),
  };
  try {
    const raw = await entry.evaluator.evaluate(
      structuredClone(validateJsonValue(output)),
      criteria,
    );
    validateJsonValue(raw);
    if (
      !raw ||
      typeof raw !== "object" ||
      !["PASS", "FAIL", "ERROR"].includes(raw.status) ||
      typeof raw.explanation !== "string" ||
      (raw.score !== undefined &&
        (!Number.isFinite(raw.score) || typeof raw.score !== "number"))
    )
      throw new Error("Malformed evaluator verdict.");
    // Snapshot the returned verdict before retaining its fields as evidence.
    const verdict = structuredClone(raw);
    if (verdict.score !== undefined) evidence.score = verdict.score;
    return {
      status:
        verdict.status === "ERROR"
          ? "ERROR"
          : (verdict.status === "PASS") !== negated
            ? "PASS"
            : "FAIL",
      reason: verdict.explanation,
      evidence,
    };
  } catch (error) {
    return {
      status: "ERROR",
      reason: error instanceof Error ? error.message : String(error),
      evidence,
    };
  }
}
