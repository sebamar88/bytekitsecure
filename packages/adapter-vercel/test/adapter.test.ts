import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { jsonSchema } from "ai";
import {
  createVercelAdapter,
  vercelCapabilities,
  vercelBridgeOptions,
} from "../src/index.js";
import { harness, definitions, text, toolCall } from "./fixtures.js";
async function scenario(real: any, mock?: unknown) {
  const h = harness(mock);
  const model = new MockLanguageModelV4({
    doGenerate: [toolCall(), text()] as any,
  });
  const tools = definitions(real);
  const output = await createVercelAdapter({ model, tools })(
    { prompt: "hello" },
    h.context,
  );
  return { ...h, output, model, tools };
}
describe("Vercel adapter", () => {
  it("prevents real tool execution for a mock", async () => {
    const real = vi.fn();
    const s = await scenario(real, { answer: "mock" });
    expect(real).not.toHaveBeenCalled();
    expect(s.output).toEqual({ text: "done" });
    expect(s.model.doGenerateCalls).toHaveLength(2);
  });
  it("reports failed real execution separately from mock success", async () => {
    const s = await scenario(
      vi.fn(async () => {
        throw Error("real failure");
      }),
    );
    expect(s.messages.map((m) => m.type)).toContain("tool.failed");
    expect(s.messages.find((m) => m.type === "tool.failed").execution).toBe(
      "real",
    );
    expect(
      (await scenario(vi.fn(), { answer: "mock" })).messages.find(
        (m) => m.type === "tool.completed",
      ).execution,
    ).toBe("mock");
  });
  it("preserves tool definitions and execution options", async () => {
    const real = vi.fn(async () => ({ answer: "real" }));
    const s = await scenario(real);
    expect(s.tools.lookup.execute).toBe(real);
    expect(real.mock.calls[0][0]).toEqual({ query: "x" });
    expect(real.mock.calls[0][1].toolCallId).toBe("call1");
    expect(real.mock.calls[0][1].abortSignal).toBeInstanceOf(AbortSignal);
  });
  it("reports model completion before tool execution and total token usage", async () => {
    const s = await scenario(async () => ({ answer: "real" }));
    expect(
      s.messages.findIndex((m) => m.type === "model.completed"),
    ).toBeLessThan(s.messages.findIndex((m) => m.type === "tool.started"));
    expect(s.messages.filter((m) => m.type === "model.completed")).toHaveLength(
      2,
    );
    expect(s.messages.find((m) => m.type === "usage").payload).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
    });
    expect(
      s.messages.some(
        (m) => m.type === "message.created" && m.payload.role === "tool",
      ),
    ).toBe(true);
  });
  it("reports one failed model operation and preserves provider failure", async () => {
    const h = harness();
    const failure = Error("provider failed");
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw failure;
      },
    });
    await expect(
      createVercelAdapter({ model })({ prompt: "hello" }, h.context),
    ).rejects.toBe(failure);
    expect(h.messages.map((m) => m.type)).toEqual([
      "message.created",
      "model.started",
      "model.failed",
    ]);
  });
  it("passes cancellation to the provider", async () => {
    const h = harness();
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        h.abort.abort();
        options.abortSignal!.throwIfAborted();
        return text() as any;
      },
    });
    await expect(
      createVercelAdapter({ model })({ prompt: "hello" }, h.context),
    ).rejects.toThrow();
    expect(model.doGenerateCalls[0].abortSignal!.aborted).toBe(true);
    expect(h.messages.filter((m) => m.type === "model.failed")).toHaveLength(0);
  });
  it.each([
    { type: "provider", id: "p", args: {} },
    { inputSchema: jsonSchema({ type: "object" }) },
    { ...definitions(async () => null).lookup, needsApproval: true },
    {
      ...definitions(async () => null).lookup,
      execute: async function* () {
        yield 1;
      },
    },
  ])("rejects unsupported tool forms before model execution", (tool) => {
    const model = new MockLanguageModelV4({ doGenerate: text() as any });
    expect(() =>
      createVercelAdapter({ model, tools: { bad: tool } as any }),
    ).toThrow(/unsupported/i);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
  it("requires declarative prompt or text messages input", async () => {
    const h = harness();
    const model = new MockLanguageModelV4({ doGenerate: text() as any });
    const handler = createVercelAdapter({ model });
    await expect(handler({ anything: "x" }, h.context)).rejects.toThrow();
    await expect(
      handler({ prompt: "x", messages: [] }, h.context),
    ).rejects.toThrow();
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(
      await handler(
        { messages: [{ role: "user", content: "hello" }] },
        h.context,
      ),
    ).toEqual({ text: "done" });
  });
  it("advertises only supported observations and no cost or approvals", () => {
    expect(vercelCapabilities).not.toContain("observe.cost");
    expect(vercelCapabilities).not.toContain("control.approvals");
    expect(vercelBridgeOptions.controlApprovals).toBe(false);
    expect(vercelBridgeOptions.observations).toEqual([
      "observe.messages",
      "observe.modelCalls",
      "observe.usage",
    ]);
  });
});

import { PassThrough } from "node:stream";
import { serveAgent, agentTest } from "../../sdk/src/index.js";
import { prepareScenario, negotiateScenario } from "../../core/src/compile.js";
import { validateMessage } from "@causign/protocol";
async function bridgeScenario(action: "mock" | "real" | "cancel" | "reject") {
  const input = new PassThrough(),
    output = new PassThrough(),
    messages: any[] = [];
  let buffer = "",
    sequence = 0;
  output.on("data", (chunk) => {
    buffer += String(chunk);
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n");
      messages.push(JSON.parse(buffer.slice(0, end)));
      buffer = buffer.slice(end + 1);
    }
  });
  const send = (type: string, payload: any, extra: any = {}) =>
    input.write(
      JSON.stringify({
        protocol: "causign/1",
        id: `r${++sequence}`,
        timestamp: new Date().toISOString(),
        type,
        payload,
        ...extra,
      }) + "\n",
    );
  const until = (type: string) => {
    const found = messages.find((m) => m.type === type);
    if (found) return Promise.resolve(found);
    return new Promise<any>((resolve, reject) => {
      const check = () => {
        const message = messages.find((m) => m.type === type);
        if (message) {
          clearTimeout(timer);
          output.off("data", check);
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        output.off("data", check);
        reject(new Error(`missing ${type}`));
      }, 1000);
      output.on("data", check);
    });
  };
  const real = vi.fn(async () => {
    throw Error("real execution failed");
  });
  const model = new MockLanguageModelV4({
    doGenerate: [toolCall(), text()] as any,
  });
  const done = serveAgent(
    createVercelAdapter({ model, tools: definitions(real) }),
    { ...vercelBridgeOptions, input, output, diagnostics: new PassThrough() },
  );
  try {
    send("hello", { supportedVersions: ["causign/1"] });
    const ready = await until("adapter.ready");
    expect([...ready.payload.capabilities].sort()).toEqual(
      [...vercelCapabilities].sort(),
    );
    send("configure", { protocol: "causign/1" });
    await until("adapter.configured");
    const config: any = {
      schemaVersion: "1",
      agents: { vercel: { command: "unused", args: [] } },
      evaluators: {},
    };
    for (const requirement of ["observe.cost", "control.approvals"]) {
      const prepared = prepareScenario(
        agentTest("unsupported", {
          agent: "vercel",
          input: { prompt: "hello" },
          requirements: [requirement as any],
        }),
        config,
      );
      expect(
        negotiateScenario(prepared, validateMessage(ready) as any),
      ).toMatchObject({
        status: "INCOMPATIBLE",
        missingCapabilities: expect.arrayContaining([requirement]),
      });
    }
    const partial = prepareScenario(
      agentTest("partial", {
        agent: "vercel",
        input: null,
        requirements: ["observe.modelCalls"],
      }),
      config,
    );
    expect(
      negotiateScenario(
        partial,
        validateMessage({
          ...ready,
          payload: { ...ready.payload, capabilities: ["observe.output"] },
        }) as any,
      ).status,
    ).toBe("INCOMPATIBLE");
    send(
      "run.start",
      {
        input: { prompt: "hello" },
        interceptions:
          action === "real"
            ? []
            : [
                {
                  type: "tool",
                  name: "lookup",
                  response: { kind: "result", value: { answer: "mock" } },
                },
              ],
        approvalDecisions: [],
        limits: { scenarioTimeoutMs: 1000, interceptionTimeoutMs: 500 },
      },
      { runId: "run" },
    );
    const request = await until("tool.requested");
    if (action === "mock")
      send(
        "tool.mock",
        { response: { kind: "result", value: { answer: "mock" } } },
        {
          runId: "run",
          operationId: request.operationId,
          correlationId: request.id,
        },
      );
    if (action === "reject")
      send(
        "tool.reject",
        { source: "policy", reason: "Policy denied" },
        {
          runId: "run",
          operationId: request.operationId,
          correlationId: request.id,
        },
      );
    if (action === "cancel") {
      send("run.cancel", { reason: "stop" }, { runId: "run" });
      await until("run.cancelled");
      send(
        "tool.proceed",
        {},
        {
          runId: "run",
          operationId: request.operationId,
          correlationId: request.id,
        },
      );
    } else await until("run.completed");
    return { messages, real };
  } finally {
    input.end();
    await done;
  }
}
it.each(["mock", "real", "cancel", "reject"] as const)(
  "uses actual serveAgent protocol for %s and rejects unsupported capability requirements",
  async (action) => {
    const s = await bridgeScenario(action);
    if (action === "real") {
      expect(s.real).toHaveBeenCalledOnce();
      expect(
        s.messages.find((m) => m.type === "tool.failed").payload,
      ).toMatchObject({
        execution: "real",
        error: { message: "real execution failed" },
      });
    } else expect(s.real).not.toHaveBeenCalled();
    if (action === "mock")
      expect(
        s.messages.find((m) => m.type === "tool.completed").payload.execution,
      ).toBe("mock");
    if (action === "mock" || action === "reject")
      expect(s.messages.some((m) => m.type === "tool.started")).toBe(false);
    if (action === "reject") {
      expect(
        s.messages.find((m) => m.type === "tool.rejected").payload,
      ).toMatchObject({ name: "lookup", reason: "Policy denied" });
      expect(
        s.messages.some(
          (m) => m.type === "tool.completed" || m.type === "tool.failed",
        ),
      ).toBe(false);
    }
    expect(
      s.messages.filter((m) =>
        [
          "run.completed",
          "run.failed",
          "run.cancelled",
          "run.errored",
        ].includes(m.type),
      ),
    ).toHaveLength(1);
  },
);
it("does not fabricate unknown token counts or cost", async () => {
  const h = harness();
  const model = new MockLanguageModelV4({
    doGenerate: {
      ...text(),
      usage: {
        inputTokens: {
          total: undefined,
          noCache: undefined,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: undefined,
          text: undefined,
          reasoning: undefined,
        },
      },
    } as any,
  });
  await createVercelAdapter({ model })({ prompt: "hello" }, h.context);
  expect(h.messages.find((m) => m.type === "usage").payload).toEqual({});
});
it("rejects a returned async iterable instead of silently passing it to the framework", async () => {
  const s = await scenario(async () => ({
    async *[Symbol.asyncIterator]() {
      yield "x";
    },
  }));
  expect(s.messages.find((m) => m.type === "tool.failed").execution).toBe(
    "real",
  );
});

it("disabled bridge approvals fail before emitting observation", async () => {
  const input = new PassThrough(),
    output = new PassThrough();
  const messages: any[] = [];
  let buffer = "";
  output.on("data", (c) => {
    buffer += c;
    while (buffer.includes("\n")) {
      const i = buffer.indexOf("\n");
      messages.push(JSON.parse(buffer.slice(0, i)));
      buffer = buffer.slice(i + 1);
    }
  });
  const done = serveAgent(
    async (_, context) => {
      await context.requestApproval(null);
      return null;
    },
    { ...vercelBridgeOptions, input, output, diagnostics: new PassThrough() },
  );
  const frames = [
    { type: "hello", payload: { supportedVersions: ["causign/1"] } },
    { type: "configure", payload: { protocol: "causign/1" } },
    {
      type: "run.start",
      runId: "run",
      payload: {
        input: null,
        interceptions: [],
        approvalDecisions: [],
        limits: { scenarioTimeoutMs: 1000 },
      },
    },
  ];
  for (const [i, f] of frames.entries())
    input.write(
      JSON.stringify({
        protocol: "causign/1",
        id: `a${i}`,
        timestamp: new Date().toISOString(),
        ...f,
      }) + "\n",
    );
  try {
    for (
      let i = 0;
      i < 100 && !messages.some((m) => m.type === "run.failed");
      i++
    )
      await new Promise((r) => setTimeout(r, 2));
    expect(
      messages.find((m) => m.type === "run.failed").payload.error.message,
    ).toMatch(/disabled/);
    expect(messages.some((m) => m.type.startsWith("approval."))).toBe(false);
  } finally {
    input.end();
    await done;
  }
  await expect(
    serveAgent(async () => null, {
      observeApprovals: false,
      controlApprovals: true,
      input: new PassThrough(),
      output: new PassThrough(),
    }),
  ).rejects.toThrow(/requires approval observation/);
});
