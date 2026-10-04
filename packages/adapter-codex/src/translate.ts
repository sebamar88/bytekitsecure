import type { NativeResult } from "@causign/runtime";
/** Versioned fixture translator, not an enabled production execution profile. */
export function translateCodexResult(result: NativeResult): { text: string } {
  if (result.exitCode !== 0 || result.signal)
    throw new Error("Codex native exit was unsuccessful");
  let threadStarted = false,
    started = false,
    completed = false,
    text: string | undefined;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line);
    if (completed) throw new Error("Native event after completed turn");
    switch (event.type) {
      case "thread.started":
        if (threadStarted || started || typeof event.thread_id !== "string")
          throw new Error("Invalid thread start");
        threadStarted = true;
        break;
      case "turn.started":
        if (started) throw new Error("Duplicate turn start");
        started = true;
        break;
      case "item.started":
      case "item.updated":
        if (!started || event.item?.type !== "agent_message")
          throw new Error("Unsupported native item evidence");
        break;
      case "item.completed":
        if (
          !started ||
          event.item?.type !== "agent_message" ||
          typeof event.item.text !== "string" ||
          text !== undefined
        )
          throw new Error("Ambiguous or unsupported native output");
        text = event.item.text;
        break;
      case "turn.completed":
        if (!started || text === undefined)
          throw new Error("Missing final native output");
        completed = true;
        break;
      default:
        throw new Error("Unknown or unsuccessful native event");
    }
  }
  if (!completed || text === undefined)
    throw new Error("Missing completed native turn");
  return { text };
}
