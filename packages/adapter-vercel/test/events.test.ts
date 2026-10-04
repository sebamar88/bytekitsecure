import { expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { createVercelAdapter } from "../src/index.js";
import { harness, definitions, text, toolCall } from "./fixtures.js";
const withUsage = (
  value: ReturnType<typeof text>,
  input: number | undefined,
  output: number | undefined,
) => ({
  ...value,
  usage: { inputTokens: { total: input }, outputTokens: { total: output } },
});
it.each([
  ["input", undefined, 1, { outputTokens: 2 }],
  ["output", 2, undefined, { inputTokens: 4 }],
])(
  "keeps unknown %s usage unknown across multiple steps",
  async (_dimension, input, output, expected) => {
    const h = harness();
    const model = new MockLanguageModelV4({
      doGenerate: [toolCall(), withUsage(text(), input, output)] as any,
    });
    await createVercelAdapter({ model, tools: definitions(async () => null) })(
      { prompt: "hello" },
      h.context,
    );
    expect(h.messages.filter((m) => m.type === "model.completed")).toHaveLength(
      2,
    );
    expect(h.messages.find((m) => m.type === "usage").payload).toEqual(
      expected,
    );
  },
);
it("preserves known zero token usage instead of treating it as unknown", async () => {
  const h = harness();
  const model = new MockLanguageModelV4({
    doGenerate: withUsage(text(), 0, 0) as any,
  });
  await createVercelAdapter({ model })({ prompt: "hello" }, h.context);
  expect(h.messages.find((m) => m.type === "usage").payload).toEqual({
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  });
});
it("does not start a model or emit messages when already cancelled", async () => {
  const h = harness();
  h.abort.abort();
  const model = new MockLanguageModelV4({ doGenerate: text() as any });
  await expect(
    createVercelAdapter({ model })({ prompt: "hello" }, h.context),
  ).rejects.toThrow();
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(h.messages).toEqual([]);
});
it("preserves cancellation while waiting for a model without reporting a provider failure", async () => {
  const h = harness();
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const model = new MockLanguageModelV4({
    doGenerate: (options) =>
      new Promise((_resolve, reject) => {
        entered();
        options.abortSignal!.addEventListener(
          "abort",
          () => reject(options.abortSignal!.reason),
          { once: true },
        );
      }),
  });
  const pending = createVercelAdapter({ model })(
    { prompt: "hello" },
    h.context,
  );
  const rejected = expect(pending).rejects.toThrow();
  await started;
  h.abort.abort();
  await rejected;
  expect(h.messages.map((m) => m.type)).toEqual([
    "message.created",
    "model.started",
  ]);
});
it.each([0, -1, 1.5, NaN, Infinity])(
  "rejects invalid maxSteps %s before a model runs",
  (maxSteps) => {
    const model = new MockLanguageModelV4({ doGenerate: text() as any });
    expect(() => createVercelAdapter({ model, maxSteps })).toThrow(
      "maxSteps must be a positive integer",
    );
    expect(model.doGenerateCalls).toHaveLength(0);
  },
);
it.each([
  { messages: [] },
  { messages: [{ role: "system", content: "x" }] },
  { messages: [{ role: "user", content: 3 }] },
  { messages: [{ role: "assistant", content: "x", extra: true }] },
  { prompt: "x", messages: [{ role: "user", content: "x" }] },
  null,
])("rejects invalid input without invoking a model", async (input) => {
  const h = harness();
  const model = new MockLanguageModelV4({ doGenerate: text() as any });
  await expect(
    createVercelAdapter({ model })(input as any, h.context),
  ).rejects.toThrow();
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(h.messages).toEqual([]);
});
