import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual } from "node:util";
import {
  ProtocolSession,
  validateMessage,
  validatePlan,
  validateDirection,
  validateCorrelation,
  negotiate,
  type ProtocolMessage,
  type CausignConfig,
  type ScenarioDefinition,
  type ScenarioResult,
  type RunPlan,
  type Trace,
  type AgentReference,
} from "@causign/protocol";
import { prepareScenario, negotiateScenario } from "./compile.js";
import {
  openProcess,
  defaultTransportLimits,
  type ProcessConnection,
  type TransportLimits,
} from "./transport/process.js";
import {
  evaluateAssertions,
  createEvaluatorRegistry,
  type EvaluatorRegistry,
  type EvaluatorModuleLoader,
} from "./assertions/evaluate.js";
import { TraceCollector } from "./trace.js";
import { scenarioStatus } from "./results.js";
export { suiteExitCode } from "./results.js";
export { runSuite } from "./suite.js";
export interface RunOptions {
  limits?: TransportLimits;
  signal?: AbortSignal;
  evaluatorRegistry?: EvaluatorRegistry;
  evaluatorModuleLoader?: EvaluatorModuleLoader;
  connectionFactory?: (
    agent: AgentReference,
    limits: TransportLimits,
  ) => ProcessConnection;
  onPlan?: (plan: RunPlan) => void | Promise<void>;
  onTrace?: (trace: Trace) => void | Promise<void>;
}
const envelope = () => ({
  protocol: "causign/1" as const,
  id: `runner_${randomUUID()}`,
  timestamp: new Date().toISOString(),
});
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
class Deadline {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private reject!: (error: Error) => void;
  private stopped = false;
  readonly failure: Promise<never>;
  private abort = () => this.fail("interrupted");
  constructor(
    private connection: ProcessConnection,
    private signal?: AbortSignal,
  ) {
    this.failure = new Promise((_, reject) => {
      this.reject = reject;
    });
    void this.failure.catch(() => {});
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  arm(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail("timeout"), ms);
  }
  fail(message: string) {
    if (this.stopped) return;
    this.stopped = true;
    this.reject(new Error(message));
    void this.connection.close();
  }
  async wait<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.failure]);
  }
  dispose() {
    clearTimeout(this.timer);
    this.signal?.removeEventListener("abort", this.abort);
  }
}
interface Context {
  session: ProtocolSession;
  iterator: AsyncIterator<import("./transport/jsonl.js").ReceivedFrame>;
  deadline: Deadline;
}
async function handshake(
  connection: ProcessConnection,
  options: RunOptions,
  required: string[],
): Promise<{
  context: Context;
  ready: Extract<ProtocolMessage, { type: "adapter.ready" }>;
}> {
  const session = new ProtocolSession(),
    iterator = connection.frames[Symbol.asyncIterator](),
    deadline = new Deadline(connection, options.signal);
  deadline.arm(
    options.limits?.handshakeTimeoutMs ??
      defaultTransportLimits.handshakeTimeoutMs,
  );
  const hello: ProtocolMessage = {
    ...envelope(),
    type: "hello",
    payload: { supportedVersions: ["causign/1"] },
  };
  try {
    session.accept(hello, "runner");
    await deadline.wait(connection.send(hello));
    const f = await deadline.wait(iterator.next());
    if (f.done || f.value.diagnostic || !f.value.message)
      throw new Error(
        f.value?.diagnostic?.message ?? "Disconnected during handshake",
      );
    const ready = validateMessage(f.value.message);
    validateDirection(ready, "adapter");
    validateCorrelation(ready, new Map([[hello.id, hello]]));
    if (ready.type !== "adapter.ready" || ready.id === hello.id)
      throw new Error("Invalid adapter.ready");
    const compatibility = negotiate(ready, required);
    if (compatibility.status === "READY") {
      session.accept(ready, "adapter");
      const configure: ProtocolMessage = {
        ...envelope(),
        type: "configure",
        payload: { protocol: "causign/1" },
      };
      session.accept(configure, "runner");
      await deadline.wait(connection.send(configure));
      const ack = await deadline.wait(iterator.next());
      if (ack.done || ack.value.diagnostic || !ack.value.message)
        throw new Error("Invalid configure acknowledgement");
      session.accept(ack.value.message, "adapter");
      if (ack.value.message.type !== "adapter.configured")
        throw new Error("Expected adapter.configured");
    }
    return { context: { session, iterator, deadline }, ready };
  } catch (e) {
    deadline.dispose();
    throw e;
  }
}
export async function runScenario(
  def: ScenarioDefinition,
  config: CausignConfig,
  options: RunOptions = {},
): Promise<ScenarioResult> {
  let connection: ProcessConnection | undefined;
  let context: Context | undefined;
  try {
    const prepared = prepareScenario(def, config);
    if (prepared.definition.skipReason)
      return {
        schemaVersion: "1",
        scenarioId: def.id,
        status: "SKIP",
        assertions: [],
        diagnostics: [
          { kind: "skip", message: prepared.definition.skipReason },
        ],
      };
    connection = (options.connectionFactory ?? openProcess)(
      prepared.agent,
      options.limits ?? {},
    );
    const handshakeResult = await handshake(
      connection,
      options,
      prepared.requirements,
    );
    context = handshakeResult.context;
    const negotiated = negotiateScenario(prepared, handshakeResult.ready);
    if (negotiated.status !== "READY")
      return {
        schemaVersion: "1",
        scenarioId: def.id,
        status: negotiated.status,
        assertions: [],
        diagnostics: [{ kind: "negotiation", message: negotiated.reason }],
        ...(negotiated.status === "INCOMPATIBLE"
          ? { missingCapabilities: negotiated.missingCapabilities }
          : {}),
      };
    const plan = validatePlan({
      ...negotiated.plan,
      limits: { ...negotiated.plan.limits, ...options.limits },
    });
    const registry =
      options.evaluatorRegistry ??
      (await createEvaluatorRegistry(
        prepared.evaluators,
        options.evaluatorModuleLoader,
      ));
    await options.onPlan?.(structuredClone(plan));
    return await executeConfigured(
      plan,
      connection,
      { ...options, evaluatorRegistry: registry },
      context,
    );
  } catch (e) {
    return {
      schemaVersion: "1",
      scenarioId: def.id,
      status: "ERROR",
      assertions: [],
      diagnostics: [
        {
          kind: reason(e) === "interrupted" ? "interrupted" : "setup-error",
          message: reason(e),
        },
      ],
    };
  } finally {
    context?.deadline.dispose();
    await connection?.close();
  }
}
export async function executePlan(
  input: RunPlan,
  connection: ProcessConnection,
  options: RunOptions = {},
): Promise<ScenarioResult> {
  let plan: RunPlan | undefined;
  let context: Context | undefined;
  try {
    plan = structuredClone(validatePlan(input));
    const h = await handshake(connection, options, plan.requirements);
    context = h.context;
    const n = negotiate(h.ready, plan.requirements);
    if (n.status !== "READY")
      return {
        schemaVersion: "1",
        scenarioId: plan.scenarioId,
        planId: plan.id,
        status: n.status,
        assertions: [],
        diagnostics: [{ kind: "negotiation", message: n.reason }],
        ...(n.status === "INCOMPATIBLE"
          ? { missingCapabilities: n.missingCapabilities }
          : {}),
      };
    if (
      !isDeepStrictEqual(
        [...n.capabilities].sort(),
        [...plan.capabilities].sort(),
      )
    )
      throw new Error("Connection capabilities differ from immutable plan");
    await options.onPlan?.(structuredClone(plan));
    return await executeConfigured(plan, connection, options, context);
  } catch (e) {
    return {
      schemaVersion: "1",
      scenarioId:
        plan?.scenarioId ??
        (typeof input?.scenarioId === "string"
          ? input.scenarioId
          : "invalid-scenario"),
      ...(plan ? { planId: plan.id } : {}),
      status: "ERROR",
      assertions: [],
      diagnostics: [{ kind: "setup-error", message: reason(e) }],
    };
  } finally {
    context?.deadline.dispose();
    await connection.close();
  }
}
async function executeConfigured(
  plan: RunPlan,
  connection: ProcessConnection,
  options: RunOptions,
  context: Context,
): Promise<ScenarioResult> {
  const runId = `run_${randomUUID()}`,
    limits = { ...defaultTransportLimits, ...plan.limits, ...options.limits },
    collector = new TraceCollector(
      plan,
      runId,
      limits.maxTraceBytes,
      limits.maxMessages,
    ),
    trace = collector.trace;
  const { session, iterator, deadline } = context;
  let start: number | undefined,
    end: number | undefined,
    error = false,
    registered = false;
  const send = async (message: ProtocolMessage) => {
    session.accept(message, "runner");
    if (message.type === "run.start") registered = true;
    collector.append(message, "runner");
    await deadline.wait(connection.send(message));
  };
  try {
    deadline.arm(limits.scenarioTimeoutMs);
    start = performance.now();
    await send({
      ...envelope(),
      type: "run.start",
      runId,
      payload: {
        input: plan.input,
        interceptions: plan.interceptions,
        approvalDecisions: plan.approvalDecisions,
        limits: plan.limits,
      },
    });
    while (true) {
      const next = await deadline.wait(iterator.next());
      if (next.done) {
        if (!trace.terminal)
          throw new Error("Adapter disconnected without terminal");
        break;
      }
      const frame = next.value;
      if (frame.diagnostic || !frame.message) {
        collector.diagnostic({
          kind:
            frame.diagnostic?.kind === "transport-limit"
              ? "trace-limit-exceeded"
              : (frame.diagnostic?.kind ?? "invalid-frame"),
          message: frame.diagnostic?.message ?? "Invalid frame",
          receiveSequence: frame.receiveSequence,
          rawFrame: frame.raw,
          truncated: frame.truncated,
        });
        throw new Error(
          frame.diagnostic?.kind === "transport-limit"
            ? "trace-limit-exceeded"
            : "Invalid adapter frame",
        );
      }
      const message = frame.message;
      try {
        session.accept(message, "adapter");
      } catch (e) {
        collector.diagnostic({
          kind: "protocol-violation",
          message: reason(e),
          receiveSequence: frame.receiveSequence,
          rawFrame: frame.raw,
          messageId: message.id,
        });
        throw e;
      }
      collector.append(message, "adapter");
      if (
        message.type === "run.completed" ||
        message.type === "run.failed" ||
        message.type === "run.cancelled" ||
        message.type === "run.errored"
      ) {
        end = performance.now();
        trace.terminal = {
          type: message.type,
          source: "adapter",
          messageId: message.id,
        };
        trace.completeness =
          message.type === "run.completed" || message.type === "run.failed"
            ? "complete"
            : "incomplete";
        if (message.type === "run.cancelled" || message.type === "run.errored")
          error = true; // Drain already queued frames before closing so late transitions remain violations.
        deadline.arm(limits.terminationGraceMs);
        continue;
      }
      if (message.type === "tool.requested" && message.payload.intercepted) {
        const mock = plan.interceptions.find(
          (m) => m.name === message.payload.name,
        );
        if (!mock) throw new Error("No static interception response");
        const command: ProtocolMessage = {
          ...envelope(),
          type: "tool.mock",
          runId,
          operationId: message.operationId,
          correlationId: message.id,
          payload: { response: mock.response },
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          timer = setTimeout(
            () => deadline.fail("interception-timeout"),
            limits.interceptionTimeoutMs,
          );
          await send(command);
        } finally {
          clearTimeout(timer);
        }
      }
      if (message.type === "approval.requested") {
        const rule =
          plan.approvalDecisions.find(
            (r) =>
              Object.hasOwn(r, "input") &&
              isDeepStrictEqual(r.input, message.payload.input),
          ) ?? plan.approvalDecisions.find((r) => !Object.hasOwn(r, "input"));
        if (!rule)
          throw new Error("Unresolved approval: no configured decision");
        await send({
          ...envelope(),
          type: "approval.resolve",
          runId,
          operationId: message.operationId,
          correlationId: message.id,
          payload: { decision: rule.decision },
        });
      }
    }
  } catch (e) {
    if (trace.terminal && reason(e) === "timeout") {
      /* A valid terminal permits bounded cleanup of an idle process. */
    } else {
      error = true;
      trace.completeness = "incomplete";
      collector.diagnostic({
        kind:
          reason(e) === "interrupted"
            ? "interrupted"
            : reason(e).includes("trace-limit")
              ? "trace-limit-exceeded"
              : "execution-error",
        message: reason(e),
      });
    }
    if (!trace.terminal && registered) {
      session.finalizeInterrupted(runId);
      const terminal: ProtocolMessage = {
        ...envelope(),
        type: "run.errored",
        runId,
        payload: { error: { message: reason(e).slice(0, 512) } },
      };
      collector.append(terminal, "runner", true);
      trace.terminal = {
        type: "run.errored",
        source: "runner",
        messageId: terminal.id,
      };
    }
  } finally {
    deadline.dispose();
    await connection.close();
  }
  if (connection.stderr.totalBytes)
    collector.diagnostic({
      kind: "stderr",
      message: connection.stderr.text,
      truncated: connection.stderr.truncated,
    });
  const metrics = {
    ...(start !== undefined
      ? { executionLatencyMs: (end ?? performance.now()) - start }
      : {}),
    latencyComplete: !error && trace.completeness === "complete",
  };
  const assertions = await evaluateAssertions(
    plan,
    trace,
    metrics,
    options.evaluatorRegistry ?? {},
  );
  const result: ScenarioResult = {
    schemaVersion: "1",
    scenarioId: plan.scenarioId,
    planId: plan.id,
    runId,
    traceId: trace.id,
    status: scenarioStatus(trace.terminal?.type, assertions, error),
    assertions,
    diagnostics: structuredClone(trace.diagnostics),
    executionDurationMs: metrics.executionLatencyMs,
  };
  try {
    await options.onTrace?.(structuredClone(trace));
  } catch (e) {
    result.status = "ERROR";
    result.diagnostics.push({
      kind: "artifact-error",
      message: reason(e).slice(0, 512),
    });
  }
  return result;
}
