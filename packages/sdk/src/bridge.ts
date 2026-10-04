import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  ProtocolSession,
  validateMessage,
  validateJsonValue,
  type ProtocolMessage,
  type RunStart,
  type JsonValue,
  type Usage,
} from "@causign/protocol";
import type { AgentContext } from "./instrument.js";
export interface BridgeOptions {
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
  name?: string;
  version?: string;
  maxBufferedOutputBytes?: number;
  observations?: readonly (
    "observe.messages" | "observe.modelCalls" | "observe.usage"
  )[];
  approval?: (
    input: JsonValue,
    signal: AbortSignal,
  ) => Promise<"grant" | "reject">;
  controlApprovals?: boolean;
  observeApprovals?: boolean;
}
export type AgentHandler = (
  input: JsonValue,
  context: AgentContext,
) => Promise<JsonValue>;
class Interrupted extends Error {}
class TransportFailure extends Error {}
const capabilities = [
  "observe.output",
  "observe.toolRequests",
  "observe.toolExecution",
  "observe.toolResults",
  "observe.toolRejections",
  "intercept.tools",
  "observe.approvals",
  "control.cancel",
];
export async function serveAgent(
  handler: AgentHandler,
  options: BridgeOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin,
    output = options.output ?? process.stdout,
    diagnostics = options.diagnostics ?? process.stderr;
  if (
    options.observations?.some(
      (value) =>
        !["observe.messages", "observe.modelCalls", "observe.usage"].includes(
          value,
        ),
    )
  )
    throw new Error("Unsupported bridge observation capability");
  const maxOutput = options.maxBufferedOutputBytes ?? 1048576;
  if (!Number.isSafeInteger(maxOutput) || maxOutput < 1)
    throw new Error("maxBufferedOutputBytes must be a positive integer");
  const session = new ProtocolSession(),
    runs = new Map<
      string,
      {
        active: boolean;
        abort: AbortController;
        pending: Map<
          string,
          {
            resolve: (m: ProtocolMessage) => void;
            reject: (e: Error) => void;
            timer: ReturnType<typeof setTimeout>;
          }
        >;
        timer: ReturnType<typeof setTimeout>;
      }
    >();
  if (options.observeApprovals === false && options.controlApprovals === true)
    throw new Error("Approval control requires approval observation");
  const advertised = [
    ...capabilities.filter(
      (cap) =>
        options.observeApprovals !== false || cap !== "observe.approvals",
    ),
    ...(options.controlApprovals === false || options.observeApprovals === false
      ? []
      : ["control.approvals"]),
    ...(options.observations ?? []),
  ];
  let serial = 0;
  const diagnostic = (message: string) => {
    diagnostics.write(message + "\n");
  };
  const emit = (
    type: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ) => {
    const m = validateMessage({
      protocol: "causign/1",
      id: `sdk:${++serial}`,
      timestamp: new Date().toISOString(),
      type,
      payload,
      ...extra,
    });
    const line = JSON.stringify(m) + "\n";
    if (
      output.destroyed ||
      output.writableLength + Buffer.byteLength(line) > maxOutput
    )
      throw new TransportFailure(
        "Protocol output disconnected or buffer limit exceeded",
      );
    session.accept(m, "adapter");
    if (!output.write(line)) input.pause();
    return m;
  };
  const stop = (runId: string) => {
    const run = runs.get(runId);
    if (!run || !run.active) return;
    run.active = false;
    clearTimeout(run.timer);
    for (const p of run.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Interrupted("Run closed"));
    }
    run.pending.clear();
    run.abort.abort();
  };
  const terminal = (
    runId: string,
    type: string,
    payload: unknown,
    extra = {},
  ) => {
    if (!runs.get(runId)?.active) return;
    try {
      emit(type, payload, { runId, ...extra });
    } catch (error) {
      // A bounded output refusal is transport loss, not a frame we can claim to emit.
      if (error instanceof TransportFailure) {
        diagnostic(`Transport failure: ${error.message}`);
        disconnect();
      } else
        try {
          if (type !== "run.errored")
            emit(
              "run.errored",
              { error: { message: String(error) } },
              { runId },
            );
        } catch (fallbackError) {
          diagnostic(
            `Transport failure: unable to emit terminal: ${String(fallbackError)}`,
          );
          disconnect();
        }
    } finally {
      stop(runId);
    }
  };
  const start = (message: RunStart) => {
    const run = {
      active: true,
      abort: new AbortController(),
      pending: new Map<
        string,
        {
          resolve: (m: ProtocolMessage) => void;
          reject: (e: Error) => void;
          timer: ReturnType<typeof setTimeout>;
        }
      >(),
      timer: setTimeout(
        () =>
          terminal(message.runId, "run.errored", {
            error: { message: "Scenario timeout" },
          }),
        message.payload.limits.scenarioTimeoutMs,
      ),
    };
    runs.set(message.runId, run);
    const active = () => {
      if (!run.active) throw new Interrupted("Run closed");
    };
    let operations = 0;
    let usage: Usage | undefined;
    const event = (type: string, payload: unknown, operationId?: string) => {
      active();
      return emit(type, payload, {
        runId: message.runId,
        ...(operationId ? { operationId } : {}),
      });
    };
    const wait = (operationId: string) =>
      new Promise<ProtocolMessage>((resolve, reject) => {
        active();
        const timer = setTimeout(() => {
          run.pending.delete(operationId);
          reject(new Interrupted("Decision timeout"));
          terminal(message.runId, "run.errored", {
            error: { message: "Decision timeout" },
          });
        }, message.payload.limits.interceptionTimeoutMs ?? message.payload.limits.scenarioTimeoutMs);
        run.pending.set(operationId, { resolve, reject, timer });
      });
    const error = (value: unknown) => ({
      message:
        value instanceof Error
          ? value.message
          : typeof value === "string"
            ? value
            : "Tool error",
      ...(value instanceof Error ? {} : { details: validateJsonValue(value) }),
    });
    const context: AgentContext = {
      signal: run.abort.signal,
      diagnostic,
      rejectTool(name, input, rejection) {
        active();
        validateJsonValue(input);
        validateJsonValue(rejection);
        if (message.payload.interceptions.some((m) => m.name === name))
          throw new Error(
            "Local rejectTool cannot reject a selected tool; an explicit runner tool.reject decision is required",
          );
        const op = `operation:${++operations}`;
        event("tool.requested", { name, input, intercepted: false }, op);
        event("tool.rejected", { name, ...rejection }, op);
        throw new Error(rejection.reason);
      },
      async callTool(name, input, execute) {
        active();
        validateJsonValue(input);
        const op = `operation:${++operations}`;
        const selected = message.payload.interceptions.some(
          (m) => m.name === name,
        );
        event("tool.requested", { name, input, intercepted: selected }, op);
        if (selected) {
          const decision = await wait(op);
          active();
          if (decision.type === "tool.mock") {
            const response = decision.payload.response;
            if (response.kind === "result") {
              event(
                "tool.completed",
                { name, output: response.value, execution: "mock" },
                op,
              );
              return response.value;
            }
            event(
              "tool.failed",
              { name, error: error(response.value), execution: "mock" },
              op,
            );
            throw new Error("Mock tool error");
          }
          if (decision.type === "tool.reject") {
            event("tool.rejected", { name, ...decision.payload }, op);
            throw new Error(decision.payload.reason);
          }
          if (decision.type !== "tool.proceed")
            throw new Error("Invalid tool decision");
        }
        active();
        event("tool.started", { name }, op);
        try {
          const result = validateJsonValue(await execute());
          active();
          event(
            "tool.completed",
            { name, output: result, execution: "real" },
            op,
          );
          return result;
        } catch (e) {
          active();
          event(
            "tool.failed",
            { name, error: error(e), execution: "real" },
            op,
          );
          throw e;
        }
      },
      async requestApproval(input) {
        active();
        if (options.observeApprovals === false)
          throw new Error("Approval observation is disabled by this adapter");
        validateJsonValue(input);
        const op = `operation:${++operations}`;
        event("approval.requested", { input }, op);
        let decision: "grant" | "reject";
        if (
          options.controlApprovals !== false &&
          message.payload.approvalDecisions.length
        ) {
          const command = await wait(op);
          if (command.type !== "approval.resolve")
            throw new Error("Invalid approval decision");
          decision = command.payload.decision;
        } else if (options.approval) {
          decision = await options.approval(input, run.abort.signal);
        } else {
          terminal(message.runId, "run.errored", {
            error: {
              message:
                "Approval requires configured decision or approval handler",
            },
          });
          throw new Interrupted("Unresolved approval");
        }
        active();
        event("approval.completed", { decision }, op);
        return decision;
      },
      message(payload) {
        event("message.created", payload);
      },
      modelStarted(payload) {
        const op = `operation:${++operations}`;
        event("model.started", payload, op);
        return op;
      },
      modelCompleted(op, payload) {
        event("model.completed", payload, op);
      },
      modelFailed(op, value) {
        event("model.failed", { error: error(value) }, op);
      },
      reportUsage(value) {
        active();
        if (!advertised.includes("observe.usage"))
          throw new Error("Usage observation not enabled");
        validateMessage({
          protocol: "causign/1",
          id: "usage-validation",
          timestamp: new Date().toISOString(),
          type: "run.completed",
          runId: message.runId,
          payload: { output: null, usage: value },
        });
        usage = structuredClone(value);
      },
    };
    emit(
      "run.started",
      {},
      { runId: message.runId, correlationId: message.id },
    );
    void Promise.resolve()
      .then(() => handler(message.payload.input, context))
      .then(
        (result) => {
          if (run.active)
            terminal(message.runId, "run.completed", {
              output: validateJsonValue(result),
              ...(usage ? { usage } : {}),
            });
        },
        (e) => {
          if (run.active)
            terminal(message.runId, "run.failed", {
              error: error(e),
              ...(usage ? { usage } : {}),
            });
        },
      )
      .catch((e) => {
        if (run.active)
          terminal(message.runId, "run.errored", {
            error: { message: String(e) },
          });
      });
  };
  const lines = createInterface({ input, crlfDelay: Infinity });
  const disconnect = () => {
    for (const [id, run] of runs)
      if (run.active) {
        session.finalizeInterrupted(id);
        stop(id);
      }
    lines.close();
  };
  const outputError = (error: Error) => {
    diagnostic(`Output disconnected: ${error.message}`);
    disconnect();
  };
  const drain = () => input.resume();
  output.on("drain", drain);
  output.on("error", outputError);
  output.on("close", disconnect);
  input.on("error", outputError);
  try {
    for await (const line of lines) {
      try {
        const m = validateMessage(JSON.parse(line));
        if ("runId" in m && runs.get(m.runId)?.active === false) {
          diagnostic("Discarded late command for closed run");
          continue;
        }
        session.accept(m, "runner");
        switch (m.type) {
          case "hello":
            emit(
              "adapter.ready",
              {
                adapter: {
                  name: options.name ?? "causign-sdk",
                  version: options.version ?? "0.1.1",
                },
                supportedVersions: ["causign/1"],
                capabilities: advertised,
              },
              { correlationId: m.id },
            );
            break;
          case "configure":
            emit("adapter.configured", {}, { correlationId: m.id });
            break;
          case "run.start":
            start(m);
            break;
          case "run.cancel":
            terminal(
              m.runId,
              "run.cancelled",
              { reason: m.payload.reason },
              { correlationId: m.id },
            );
            break;
          case "tool.proceed":
          case "tool.mock":
          case "tool.reject":
          case "approval.resolve": {
            const run = runs.get(m.runId),
              pending = run?.pending.get(m.operationId);
            if (!pending) throw new Error("Missing pending operation");
            clearTimeout(pending.timer);
            run!.pending.delete(m.operationId);
            pending.resolve(m);
            break;
          }
        }
      } catch (e) {
        diagnostic(`Protocol error: ${String(e)}`);
        for (const [id, run] of runs)
          if (run.active)
            terminal(id, "run.errored", { error: { message: String(e) } });
        lines.close();
        break;
      }
    }
  } finally {
    disconnect();
    output.off("drain", drain);
    output.off("error", outputError);
    output.off("close", disconnect);
    input.off("error", outputError);
  }
}
