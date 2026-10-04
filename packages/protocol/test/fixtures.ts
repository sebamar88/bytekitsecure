// Hand-authored protocol fixtures. Helpers deliberately do not invoke validators.
export const timestamp = "2026-09-30T00:00:00Z";
export function ready(capabilities: string[] = []) {
  return {
    protocol: "causign/1",
    id: "ready_1",
    type: "adapter.ready",
    timestamp,
    correlationId: "hello_1",
    payload: {
      adapter: { name: "fixture", version: "1.0.0" },
      supportedVersions: ["causign/1"],
      capabilities,
    },
  };
}
export function scenario(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "1",
    id: "scenario_1",
    name: "fixture",
    agent: "fixture",
    input: null,
    mocks: [],
    assertions: [],
    requirements: [],
    timeoutMs: 30000,
    ...overrides,
  };
}
export function frame(type: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol: "causign/1",
    id: "message_1",
    type,
    timestamp,
    runId: "run_1",
    payload: {},
    ...overrides,
  };
}
export function trace(events: unknown[] = [], completeness = "complete") {
  return {
    schemaVersion: "1",
    id: "trace_1",
    runId: "run_1",
    planId: "plan_1",
    events,
    diagnostics: [],
    completeness,
  };
}
export function result(status = "PASS") {
  return {
    schemaVersion: "1",
    scenarioId: "scenario_1",
    status,
    assertions: [],
    diagnostics: [],
  };
}
