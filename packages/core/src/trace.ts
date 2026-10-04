import { randomUUID } from "node:crypto";
import type {
  RunPlan,
  Trace,
  ProtocolMessage,
  Diagnostic,
} from "@causign/protocol";
export class TraceCollector {
  readonly trace: Trace;
  private bytes = 0;
  private sequence = 0;
  private localBytes = 0;
  // Local error records have a separate fixed reserve. They cannot erase facts
  // or let hostile raw frames/stderr grow retained memory without a bound.
  static readonly localReserveBytes = 8192;
  constructor(
    plan: RunPlan,
    runId: string,
    private limit: number,
    private messageLimit: number,
  ) {
    this.trace = {
      schemaVersion: "1",
      id: `trace_${randomUUID()}`,
      planId: plan.id,
      runId,
      events: [],
      diagnostics: [],
      completeness: "incomplete",
    };
  }
  append(
    message: ProtocolMessage,
    source: "runner" | "adapter",
    local = false,
  ) {
    const size = Buffer.byteLength(JSON.stringify(message));
    if (
      !local &&
      (this.bytes + size > this.limit ||
        this.trace.events.length >= this.messageLimit)
    )
      throw new Error("trace-limit-exceeded");
    if (local) {
      if (this.localBytes + size > TraceCollector.localReserveBytes)
        throw new Error("Local trace reserve exceeded");
      this.localBytes += size;
    } else this.bytes += size;
    this.trace.events.push({
      receiveSequence: ++this.sequence,
      message: structuredClone(message),
      source,
    });
  }
  diagnostic(diagnostic: Diagnostic) {
    if (this.trace.diagnostics.length >= 3) return;
    const raw = diagnostic.rawFrame;
    const preview = raw !== undefined ? diagnosticPreview(raw) : undefined;
    const message = diagnosticPreview(diagnostic.message);
    const retained: Diagnostic = {
      kind: diagnostic.kind.slice(0, 64),
      message,
      ...(diagnostic.receiveSequence !== undefined
        ? { receiveSequence: diagnostic.receiveSequence }
        : {}),
      ...(diagnostic.messageId
        ? { messageId: diagnostic.messageId.slice(0, 128) }
        : {}),
      ...(diagnostic.operationId
        ? { operationId: diagnostic.operationId.slice(0, 128) }
        : {}),
      ...(preview !== undefined ? { rawFrame: preview } : {}),
      truncated: Boolean(
        diagnostic.truncated ||
        message !== diagnostic.message ||
        (preview !== undefined && preview !== raw),
      ),
    };
    const size = Buffer.byteLength(JSON.stringify(retained));
    if (this.localBytes + size > TraceCollector.localReserveBytes - 2048)
      return;
    this.localBytes += size;
    this.trace.diagnostics.push(retained);
  }
}

function diagnosticPreview(value: string) {
  const bytes = Buffer.from(value);
  let end = Math.min(bytes.length, 512);
  while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}
