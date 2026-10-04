import { expect, it, vi } from "vitest";
import { wrapTools } from "../src/tools.js";
import { harness, definitions } from "./fixtures.js";
it.each([undefined, NaN, Infinity, () => null])(
  "reports invalid real JSON output as a tool failure",
  async (value) => {
    const h = harness();
    const execute = vi.fn(async () => value);
    const tools = wrapTools(definitions(execute), h.context);
    await expect(
      tools.lookup.execute!({ query: "x" }, {} as any),
    ).rejects.toThrow();
    expect(execute).toHaveBeenCalledOnce();
    expect(h.messages.map((m) => m.type)).toEqual([
      "tool.requested",
      "tool.started",
      "tool.failed",
    ]);
  },
);
it("does not invoke a real tool after cancellation at the request boundary", async () => {
  const h = harness();
  h.abort.abort();
  const execute = vi.fn(async () => null);
  const tools = wrapTools(definitions(execute), h.context);
  await expect(
    tools.lookup.execute!({ query: "x" }, {} as any),
  ).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it("passes the execution abort signal to a pending tool", async () => {
  const h = harness();
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const execute = vi.fn(
    (_input, options) =>
      new Promise((_resolve, reject) => {
        entered();
        options.abortSignal.addEventListener(
          "abort",
          () => reject(options.abortSignal.reason),
          { once: true },
        );
      }),
  );
  const tools = wrapTools(definitions(execute), h.context);
  const pending = tools.lookup.execute!({ query: "x" }, {
    abortSignal: h.abort.signal,
  } as any);
  const rejected = expect(pending).rejects.toThrow();
  await started;
  h.abort.abort();
  await rejected;
  expect(execute).toHaveBeenCalledOnce();
  expect(h.messages.at(-1).type).toBe("tool.failed");
});
