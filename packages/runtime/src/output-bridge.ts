import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  ProtocolSession,
  validateMessage,
  type JsonValue,
  type RunStart,
} from "@causign/protocol";
export interface OutputDriver {
  name: string;
  version: string;
  execute(
    input: JsonValue,
    context: { signal: AbortSignal; timeoutMs: number },
  ): Promise<{ text: string }>;
}
export interface OutputBridgeOptions {
  input?: Readable;
  output?: Writable;
  diagnostics?: Writable;
}
export async function serveOutputBridge(
  driver: OutputDriver,
  options: OutputBridgeOptions = {},
): Promise<void> {
  const input = options.input ?? process.stdin,
    output = options.output ?? process.stdout,
    diagnostics = options.diagnostics ?? process.stderr;
  const session = new ProtocolSession(),
    controller = new AbortController();
  let serial = 0,
    active: RunStart | undefined,
    terminal = false,
    lineBytes = 0,
    job: Promise<void> | undefined;
  const lines = createInterface({ input, crlfDelay: Infinity });
  const emit = (
    type: string,
    payload: unknown,
    extra: Record<string, string> = {},
  ) => {
    const message = validateMessage({
      protocol: "causign/1",
      id: `output:${++serial}`,
      timestamp: new Date().toISOString(),
      type,
      payload,
      ...extra,
    });
    const line = JSON.stringify(message) + "\n";
    if (
      Buffer.byteLength(line) > 1048576 ||
      output.destroyed ||
      output.writableLength + Buffer.byteLength(line) > 2097152
    )
      throw new Error("Protocol output disconnected or byte limit exceeded");
    session.accept(message, "adapter");
    output.write(line);
  };
  const close = () => {
    controller.abort();
    lines.close();
    input.pause();
  };
  const finish = (type: string, payload: unknown) => {
    if (terminal || !active) return;
    terminal = true;
    try {
      emit(type, payload, { runId: active.runId });
    } finally {
      close();
    }
  };
  const diagnose = (error: unknown) => {
    diagnostics.write(
      `Protocol/adapter error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  };
  const failure = (error: unknown) => {
    diagnose(error);
    try {
      finish("run.errored", {
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      });
    } catch {
      close();
    }
    close();
  };
  const bounded = (chunk: Buffer | string) => {
    for (const byte of Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) {
      if (byte === 10) lineBytes = 0;
      else if (++lineBytes > 1048576) {
        failure(new Error("Protocol input frame byte limit exceeded"));
        break;
      }
    }
  };
  const disconnected = () => close();
  input.on("data", bounded);
  input.on("error", failure);
  output.on("error", failure);
  output.on("close", disconnected);
  const signalShutdown = () => close();
  if (!options.input) {
    process.on("SIGTERM", signalShutdown);
    process.on("SIGINT", signalShutdown);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    for await (const line of lines) {
      if (controller.signal.aborted) break;
      try {
        const message = validateMessage(JSON.parse(line));
        session.accept(message, "runner");
        if (message.type === "hello")
          emit(
            "adapter.ready",
            {
              adapter: { name: driver.name, version: driver.version },
              supportedVersions: ["causign/1"],
              capabilities: ["observe.output"],
            },
            { correlationId: message.id },
          );
        else if (message.type === "configure")
          emit("adapter.configured", {}, { correlationId: message.id });
        else if (message.type === "run.start") {
          active = message;
          if (
            message.payload.interceptions.length ||
            message.payload.approvalDecisions.length
          )
            throw new Error(
              "Output profile does not support tool or approval control",
            );
          emit(
            "run.started",
            {},
            { runId: message.runId, correlationId: message.id },
          );
          timer = setTimeout(
            () =>
              finish("run.errored", {
                error: { message: "Native scenario timeout" },
              }),
            message.payload.limits.scenarioTimeoutMs,
          );
          job = Promise.resolve()
            .then(() =>
              driver.execute(message.payload.input, {
                signal: controller.signal,
                timeoutMs: message.payload.limits.scenarioTimeoutMs,
              }),
            )
            .then((result) => {
              if (!result || typeof result.text !== "string")
                throw new Error("Missing final native text output");
              finish("run.completed", { output: result });
            })
            .catch(failure);
        } else if (message.type === "run.cancel")
          finish("run.cancelled", { reason: message.payload.reason });
        else throw new Error("Unsupported output bridge command");
      } catch (error) {
        failure(error);
        break;
      }
    }
  } finally {
    close();
    clearTimeout(timer);
    input.off("data", bounded);
    input.off("error", failure);
    output.off("error", failure);
    output.off("close", disconnected);
    if (!options.input) {
      process.off("SIGTERM", signalShutdown);
      process.off("SIGINT", signalShutdown);
    }
    await job;
  }
}
