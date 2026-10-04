import { validateMessage, type ProtocolMessage } from "@causign/protocol";
export interface ReceivedFrame {
  receiveSequence: number;
  raw: string;
  rawBytes: number;
  truncated: boolean;
  message?: ProtocolMessage;
  diagnostic?: { kind: string; message: string };
}
/** Byte framing preserves split code points and detects malformed UTF-8. */
export class JsonlDecoder {
  private bytes: number[] = [];
  private length = 0;
  private sequence = 0;
  constructor(private readonly maxFrameBytes: number) {}
  get bufferedBytes() {
    return this.bytes.length;
  }
  push(byte: number): ReceivedFrame | undefined {
    if (byte === 10) return this.finish(false);
    this.length++;
    if (this.bytes.length < this.maxFrameBytes) this.bytes.push(byte);
  }
  eof(): ReceivedFrame | undefined {
    return this.length ? this.finish(true) : undefined;
  }
  private finish(partial: boolean): ReceivedFrame {
    const data = Uint8Array.from(this.bytes);
    const frame: ReceivedFrame = {
      receiveSequence: ++this.sequence,
      raw: "",
      rawBytes: this.length,
      truncated: this.length > this.maxFrameBytes,
    };
    this.bytes = [];
    this.length = 0;
    // Replacement is allowed only for a diagnostic preview, never parsed data.
    frame.raw = new TextDecoder().decode(data);
    if (frame.truncated)
      frame.diagnostic = {
        kind: "frame-limit",
        message: "Frame exceeded maxFrameBytes",
      };
    else if (partial)
      frame.diagnostic = {
        kind: "partial-frame",
        message: "EOF before newline",
      };
    else {
      try {
        frame.raw = new TextDecoder("utf-8", { fatal: true }).decode(data);
      } catch {
        frame.diagnostic = {
          kind: "invalid-utf8",
          message: "Frame is not UTF-8",
        };
        return frame;
      }
      let value: unknown;
      try {
        value = JSON.parse(frame.raw);
      } catch {
        frame.diagnostic = {
          kind: "invalid-json",
          message: "Frame is not JSON",
        };
        return frame;
      }
      try {
        frame.message = validateMessage(value);
      } catch (error) {
        frame.diagnostic = { kind: "invalid-schema", message: String(error) };
      }
    }
    return frame;
  }
}
