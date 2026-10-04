import { spawn } from "node:child_process";
import {
  validateMessage,
  type AgentReference,
  type ProtocolMessage,
} from "@causign/protocol";
import { JsonlDecoder, type ReceivedFrame } from "./jsonl.js";
export interface TransportLimits {
  maxFrameBytes?: number;
  maxStderrBytes?: number;
  maxTraceBytes?: number;
  maxMessages?: number;
  maxBufferedBytes?: number;
  terminationGraceMs?: number;
  handshakeTimeoutMs?: number;
  scenarioTimeoutMs?: number;
  interceptionTimeoutMs?: number;
}
export const defaultTransportLimits = {
  maxFrameBytes: 1048576,
  maxStderrBytes: 65536,
  maxTraceBytes: 33554432,
  maxMessages: 100000,
  maxBufferedBytes: 2097152,
  terminationGraceMs: 1000,
  handshakeTimeoutMs: 10000,
  scenarioTimeoutMs: 30000,
  interceptionTimeoutMs: 5000,
} as const;
export interface ProcessConnection {
  send(message: ProtocolMessage): Promise<void>;
  frames: AsyncIterable<ReceivedFrame>;
  close(): Promise<void>;
  readonly stderr: { text: string; truncated: boolean; totalBytes: number };
  readonly bufferedBytes: number;
  readonly receivedBytes: number;
  readonly exit:
    | { code: number | null; signal: NodeJS.Signals | null; error?: string }
    | undefined;
}
export function openProcess(
  agent: AgentReference,
  overrides: TransportLimits = {},
): ProcessConnection {
  const limits = { ...defaultTransportLimits, ...overrides };
  for (const [key, value] of Object.entries(limits))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new RangeError(`${key} must be a positive safe integer`);
  // Reserve native HWM, one native read overshoot, and one retained read chunk.
  // Lower values cannot promise the configured bound using public Node pipes.
  if (limits.maxBufferedBytes < 262144)
    throw new RangeError(
      "maxBufferedBytes must be at least 262144 bytes for Node pipe buffering",
    );
  const child = spawn(agent.command, agent.args, {
    shell: false,
    cwd: agent.cwd,
    env: agent.env ? { ...process.env, ...agent.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const output = child.stdout;
  // Keep readable mode active even while yielding to the consumer. Node resumes
  // child stdio on exit; a persistent readable listener prevents that auto-drain
  // from switching to flowing mode and discarding pending bytes.
  output.on("readable", () => {});
  const decoder = new JsonlDecoder(limits.maxFrameBytes);
  let ended = false,
    closing = false,
    spawnError: Error | undefined,
    exit: ProcessConnection["exit"],
    closePromise: Promise<void> | undefined;
  let captured = Buffer.alloc(0),
    stderrBytes = 0,
    receivedBytes = 0,
    chunkBytes = 0,
    count = 0,
    pendingWriteBytes = 0,
    consuming = false;
  const completion = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      ended = true;
      exit = {
        code,
        signal,
        ...(spawnError ? { error: spawnError.message } : {}),
      };
      resolve();
    });
  });
  // Always drain diagnostics, even after retention is full.
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    const remaining = limits.maxStderrBytes - captured.length;
    if (remaining > 0)
      captured = Buffer.concat([captured, chunk.subarray(0, remaining)]);
  });
  child.stdin.on("error", () => {});
  async function close() {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      output.destroy();
      child.stdout.destroy();
      if (!ended) {
        // EOF gives adapters time to abort and reap their own native children.
        child.stdin.end();
        let fallback: ReturnType<typeof setTimeout> | undefined;
        const timer = setTimeout(() => {
          if (ended) return;
          if (process.platform === "win32" && child.pid) {
            const killer = spawn(
              "taskkill.exe",
              ["/pid", String(child.pid), "/T", "/F"],
              { windowsHide: true, stdio: "ignore" },
            );
            killer.once("error", () => child.kill("SIGKILL"));
            killer.once("close", (code) => {
              if (code !== 0 && !ended) child.kill("SIGKILL");
            });
            fallback = setTimeout(() => {
              if (!ended) child.kill("SIGKILL");
              killer.kill();
            }, 250);
          } else {
            child.kill("SIGTERM");
            fallback = setTimeout(() => {
              if (!ended) child.kill("SIGKILL");
            }, 250);
          }
        }, limits.terminationGraceMs);
        try {
          await completion;
        } finally {
          clearTimeout(timer);
          clearTimeout(fallback);
        }
      }
    })();
    return closePromise;
  }
  async function* frames(): AsyncGenerator<ReceivedFrame> {
    if (consuming) throw new Error("Frames have a single consumer");
    consuming = true;
    let sequence = 0;
    try {
      // Node's pipe buffer and the OS pipe are separate from the bounded decoder;
      // no frame queue is retained and each chunk is released before another read.
      while (!closing) {
        const data = output.read(
          Math.min(65536, output.readableLength || 1),
        ) as Buffer | null;
        if (data === null) {
          if (output.readableEnded || output.destroyed) break;
          await new Promise<void>((resolve) => {
            const wake = () => {
              for (const event of ["readable", "end", "close", "error"])
                output.off(event, wake);
              resolve();
            };
            for (const event of ["readable", "end", "close", "error"])
              output.once(event, wake);
          });
          continue;
        }
        for (let offset = 0; offset < data.length; offset++) {
          if (closing) return;
          receivedBytes++;
          chunkBytes = data.length - offset;
          if (receivedBytes > limits.maxTraceBytes) {
            const partial = decoder.eof();
            await close();
            yield {
              ...(partial ?? {
                receiveSequence: ++sequence,
                raw: "",
                rawBytes: 0,
              }),
              truncated: true,
              diagnostic: {
                kind: "transport-limit",
                message: "maxTraceBytes exceeded",
              },
            };
            return;
          }
          const frame = decoder.push(data[offset]!);
          if (frame) {
            sequence = frame.receiveSequence;
            if (++count > limits.maxMessages) {
              delete frame.message;
              await close();
              yield {
                ...frame,
                truncated: true,
                diagnostic: {
                  kind: "transport-limit",
                  message: "maxMessages exceeded",
                },
              };
              return;
            }
            yield frame;
          }
        }
        chunkBytes = 0;
      }
      if (!closing) {
        const partial = decoder.eof();
        if (partial) yield partial;
      }
    } catch (error) {
      if (!closing && !spawnError)
        yield {
          receiveSequence: ++sequence,
          raw: "",
          rawBytes: 0,
          truncated: false,
          diagnostic: { kind: "stream-error", message: String(error) },
        };
    }
    await completion;
    if (spawnError && !closing)
      yield {
        receiveSequence: ++sequence,
        raw: "",
        rawBytes: 0,
        truncated: false,
        diagnostic: { kind: "spawn-error", message: spawnError.message },
      };
  }
  return {
    frames: { [Symbol.asyncIterator]: frames },
    close,
    async send(message) {
      validateMessage(message);
      if (closing || ended || spawnError) throw new Error("Process is closed");
      const bytes = Buffer.from(JSON.stringify(message) + "\n");
      if (bytes.length - 1 > limits.maxFrameBytes)
        throw new Error("Outbound frame exceeded maxFrameBytes");
      if (pendingWriteBytes + bytes.length > limits.maxBufferedBytes)
        throw new Error("Outbound maxBufferedBytes exceeded");
      pendingWriteBytes += bytes.length;
      try {
        await new Promise<void>((resolve, reject) =>
          child.stdin.write(bytes, (error) =>
            error ? reject(error) : resolve(),
          ),
        );
      } finally {
        pendingWriteBytes -= bytes.length;
      }
    },
    get stderr() {
      return {
        text: captured.toString("utf8"),
        truncated: stderrBytes > captured.length,
        totalBytes: stderrBytes,
      };
    },
    get bufferedBytes() {
      return output.readableLength + decoder.bufferedBytes + chunkBytes;
    },
    get receivedBytes() {
      return receivedBytes;
    },
    get exit() {
      return exit;
    },
  };
}
