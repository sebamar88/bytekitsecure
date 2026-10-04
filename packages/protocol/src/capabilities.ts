import type { AdapterReady } from "./generated.js";
import { validateMessage } from "./validate.js";
export const knownCapabilities: ReadonlySet<string> = new Set([
  "observe.output",
  "observe.messages",
  "observe.modelCalls",
  "observe.usage",
  "observe.cost",
  "observe.toolRequests",
  "observe.toolExecution",
  "observe.toolResults",
  "observe.toolRejections",
  "observe.approvals",
  "control.cancel",
  "control.approvals",
  "intercept.tools",
]);
export type NegotiationResult =
  | { status: "READY"; protocol: "causign/1"; capabilities: string[] }
  | { status: "ERROR"; reason: string }
  | { status: "INCOMPATIBLE"; reason: string; missingCapabilities: string[] };
export function negotiate(
  ready: AdapterReady,
  required: string[],
): NegotiationResult {
  try {
    validateMessage(ready);
    if (ready.type !== "adapter.ready")
      throw new Error("Expected adapter.ready");
  } catch (error) {
    return {
      status: "ERROR",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const advertised = new Set(ready.payload.capabilities);
  for (const [capability, dependencies] of [
    ["intercept.tools", ["observe.toolRequests", "observe.toolResults"]],
    ["control.approvals", ["observe.approvals"]],
  ] as const) {
    if (
      advertised.has(capability) &&
      dependencies.some((dependency) => !advertised.has(dependency))
    )
      return {
        status: "ERROR",
        reason: `${capability} requires ${dependencies.join(", ")}`,
      };
  }
  const capabilities = [...advertised].filter((capability) =>
    knownCapabilities.has(capability),
  );
  const missingCapabilities = [...new Set(required)].filter(
    (capability) => !capabilities.includes(capability),
  );
  if (!ready.payload.supportedVersions.includes("causign/1"))
    return {
      status: "INCOMPATIBLE",
      reason: "No common protocol version",
      missingCapabilities,
    };
  if (missingCapabilities.length)
    return {
      status: "INCOMPATIBLE",
      reason: "Missing required capabilities",
      missingCapabilities,
    };
  return { status: "READY", protocol: "causign/1", capabilities };
}
