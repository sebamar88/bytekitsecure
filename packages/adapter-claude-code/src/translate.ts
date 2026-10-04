import type { NativeResult } from "@causign/runtime";
export function translateClaudeResult(result: NativeResult): { text: string } {
  if (result.exitCode !== 0 || result.signal)
    throw new Error("Claude native exit was unsuccessful");
  const value = JSON.parse(result.stdout);
  if (
    !value ||
    value.type !== "result" ||
    value.subtype !== "success" ||
    value.is_error !== false ||
    typeof value.result !== "string"
  )
    throw new Error("Missing successful final Claude result");
  return { text: value.result };
}
