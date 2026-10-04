import { expect, it } from "vitest";
import { translateCodexResult } from "../src/translate.js";
const start = { type: "turn.started" };
const output = {
  type: "item.completed",
  item: { id: "i", type: "agent_message", text: "hello" },
};
const end = { type: "turn.completed" };
const translate = (
  events: unknown[],
  exitCode: number | null = 0,
  signal: NodeJS.Signals | null = null,
) =>
  translateCodexResult({
    stdout: events.map((e) => JSON.stringify(e)).join("\n"),
    stderr: "",
    exitCode,
    signal,
  });
it.each([
  ["null", [null]],
  ["array", [[]]],
  ["missing turn", []],
  ["missing completion", [start, output]],
  ["duplicate turn", [start, start, output, end]],
  ["duplicate final", [start, output, output, end]],
  ["completion before text", [start, end]],
  ["output before start", [output, end]],
  [
    "post terminal",
    [
      start,
      output,
      end,
      { type: "item.updated", item: { type: "agent_message" } },
    ],
  ],
  ["unknown", [start, { type: "unexpected" }, output, end]],
  [
    "non-message item",
    [
      start,
      { type: "item.started", item: { type: "command_execution" } },
      output,
      end,
    ],
  ],
  [
    "update before turn",
    [
      { type: "item.updated", item: { type: "agent_message" } },
      start,
      output,
      end,
    ],
  ],
  [
    "non-text output",
    [start, { ...output, item: { type: "agent_message", text: 4 } }, end],
  ],
  [
    "duplicate thread",
    [
      { type: "thread.started", thread_id: "t" },
      { type: "thread.started", thread_id: "t" },
      start,
      output,
      end,
    ],
  ],
])("rejects %s without fabricating a successful output", (_name, events) => {
  expect(() => translate(events)).toThrow();
});
it("accepts message updates and CRLF while preserving the final text", () => {
  const events = [
    { type: "thread.started", thread_id: "t" },
    start,
    { type: "item.started", item: { type: "agent_message" } },
    { type: "item.updated", item: { type: "agent_message" } },
    output,
    end,
  ];
  expect(
    translateCodexResult({
      stdout:
        "\r\n" + events.map((e) => JSON.stringify(e)).join("\r\n") + "\r\n",
      stderr: "",
      exitCode: 0,
      signal: null,
    }),
  ).toEqual({ text: "hello" });
});
it("rejects malformed JSON", () => {
  expect(() =>
    translateCodexResult({
      stdout: "{broken",
      stderr: "",
      exitCode: 0,
      signal: null,
    }),
  ).toThrow();
});
it.each([
  [1, null],
  [null, "SIGTERM"],
  [0, "SIGTERM"],
] as const)("rejects unsuccessful exit %s or signal %s", (exitCode, signal) => {
  expect(() => translate([start, output, end], exitCode, signal)).toThrow(
    "Codex native exit was unsuccessful",
  );
});
