export class ReportResponseLimit extends Error {
  constructor() {
    super(
      "Report response exceeds the 4 MiB viewing limit. Inspect the saved artifacts directly or select a smaller report.",
    );
  }
}
// Assemble only up to the budget; never stringify an amplified object first.
export function encodeReportJson(
  value: unknown,
  limit = 4 * 1024 * 1024,
): string {
  const chunks: string[] = [];
  let bytes = 0;
  const emit = (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw new ReportResponseLimit();
    chunks.push(chunk);
  };
  type Frame =
    | { kind: "value"; value: unknown }
    | {
        kind: "entries";
        iterator: Iterator<[string, unknown]>;
        array: boolean;
        first: boolean;
      };
  const stack: Frame[] = [{ kind: "value", value }];
  function* entries(
    object: object,
    array: boolean,
  ): Generator<[string, unknown]> {
    if (array) {
      const values = object as unknown[];
      for (let i = 0; i < values.length; i++) yield [String(i), values[i]];
    } else
      for (const key of Object.keys(object)) {
        const entry = (object as Record<string, unknown>)[key];
        if (
          entry !== undefined &&
          typeof entry !== "function" &&
          typeof entry !== "symbol"
        )
          yield [key, entry];
      }
  }
  while (stack.length) {
    const frame = stack.pop()!;
    if (frame.kind === "entries") {
      const next = frame.iterator.next();
      if (next.done) {
        emit(frame.array ? "]" : "}");
        continue;
      }
      if (!frame.first) emit(",");
      frame.first = false;
      if (!frame.array) emit(`${JSON.stringify(next.value[0])}:`);
      stack.push(frame, { kind: "value", value: next.value[1] });
      continue;
    }
    if (frame.value === null || typeof frame.value !== "object") {
      emit(JSON.stringify(frame.value) ?? "null");
      continue;
    }
    const array = Array.isArray(frame.value);
    emit(array ? "[" : "{");
    stack.push({
      kind: "entries",
      iterator: entries(frame.value, array),
      array,
      first: true,
    });
  }
  return chunks.join("");
}
