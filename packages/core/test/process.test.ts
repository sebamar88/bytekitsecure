import { it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import {
  openProcess as openTransport,
  type ProcessConnection,
} from "../src/transport/process.js";
import { ProtocolSession } from "../../protocol/src/index.js";
import { checkpoint } from "../../../fixtures/checkpoint-harness.mjs";
const agent = (mode: string, ...args: string[]) => ({
  command: process.execPath,
  args: [resolve("fixtures/process-agent.mjs"), mode, ...args],
});
const connections: ProcessConnection[] = [];
const openProcess: (
  ...args: Parameters<typeof openTransport>
) => ProcessConnection = (...args) => {
  const c = openTransport(...args);
  connections.push(c);
  return c;
};
afterEach(async () => {
  await Promise.all(connections.splice(0).map((c) => c.close()));
});
const collect = async (mode: string, limits = {}) => {
  const c = openProcess(agent(mode), limits);
  const frames = [];
  try {
    for await (const f of c.frames) frames.push(f);
    return { frames, c };
  } finally {
    await c.close();
  }
};
it("decodes fragmented unicode frames", async () =>
  expect((await collect("unicode")).frames[0]?.message).toMatchObject({
    payload: { input: "á🙂" },
  }));
it("preserves literal spaced arguments", async () => {
  const c = openProcess(agent("args", "folder with spaces", "$(literal)"), {});
  for await (const f of c.frames)
    expect(f.message).toMatchObject({
      payload: { input: ["folder with spaces", "$(literal)"] },
    });
  await c.close();
});
it("retains invalid JSON, schema and partial EOF frames with sequence", async () => {
  const { frames } = await collect("invalid");
  expect(frames.map((f) => f.diagnostic?.kind)).toEqual([
    "invalid-json",
    "invalid-schema",
    "partial-frame",
  ]);
  expect(frames.map((f) => f.receiveSequence)).toEqual([1, 2, 3]);
  expect(frames[2]?.raw).toBe("{partial");
});
it("marks oversized frames truncated with bounded raw capture", async () => {
  const { frames } = await collect("overflow", { maxFrameBytes: 32 });
  expect(frames[0]).toMatchObject({
    truncated: true,
    diagnostic: { kind: "frame-limit" },
  });
  expect(Buffer.byteLength(frames[0]!.raw)).toBeLessThanOrEqual(32);
});
it("rejects malformed UTF8 rather than replacing it", async () =>
  expect((await collect("utf8")).frames[0]?.diagnostic?.kind).toBe(
    "invalid-utf8",
  ));
it("drains stderr after bounded capture and reports crash", async () => {
  const { c } = await collect("stderr", { maxStderrBytes: 25 });
  expect(Buffer.byteLength(c.stderr.text)).toBeLessThanOrEqual(25);
  expect(c.stderr.truncated).toBe(true);
  expect(c.exit).toMatchObject({ code: 7 });
});
it("backpressures a fast emitter for a slow consumer", async () => {
  const c = openProcess(agent("fast"), {
    maxBufferedBytes: 262144,
    maxFrameBytes: 512,
  });
  let count = 0;
  for await (const f of c.frames) {
    expect(f.diagnostic).toBeUndefined();
    expect(f.message).toBeDefined();
    expect(c.bufferedBytes).toBeLessThanOrEqual(262656);
    count++;
    if (count % 100 === 0) await new Promise((r) => setTimeout(r, 2));
  }
  expect(count).toBe(2000);
  await c.close();
});
it.each([{ maxMessages: 2 }, { maxTraceBytes: 250 }])(
  "stops at aggregate limit %o",
  async (limits) => {
    const { frames } = await collect("fast", limits);
    expect(frames.at(-1)?.diagnostic?.kind).toBe("transport-limit");
    expect(frames.length).toBeLessThan(5);
  },
);
it("reports spawn failure and rejects sends", async () => {
  const c = openProcess(
    { command: "causign-command-that-does-not-exist", args: [] },
    {},
  );
  const frames = [];
  for await (const f of c.frames) frames.push(f);
  expect(frames[0]?.diagnostic?.kind).toBe("spawn-error");
  await expect(c.send({} as never)).rejects.toThrow();
  await c.close();
});
it("close is idempotent, terminates a waiting process and wakes iterator", async () => {
  const c = openProcess(agent("wait"), { terminationGraceMs: 20 });
  const pending = c.frames[Symbol.asyncIterator]().next();
  await c.close();
  await c.close();
  expect((await pending).done).toBe(true);
  expect(c.exit).toBeDefined();
});
it("rejects invalid limits before spawning", () =>
  expect(() => openProcess(agent("wait"), { maxFrameBytes: 0 })).toThrow());
it("rejects buffers smaller than native pipe buffering", () =>
  expect(() => openProcess(agent("wait"), { maxBufferedBytes: 1024 })).toThrow(
    "262144",
  ));
it("runs raw stdio interception checkpoint without real tool execution", async () => {
  expect(await checkpoint(openProcess, ProtocolSession)).toMatchObject({
    realExecutions: 0,
    output: { customer: "mock customer" },
    types: [
      "hello",
      "adapter.ready",
      "configure",
      "adapter.configured",
      "run.start",
      "run.started",
      "tool.requested",
      "tool.mock",
      "tool.completed",
      "run.completed",
    ],
  });
});
it("checkpoint real-tool control proves execution counter is live", async () =>
  expect(
    await checkpoint(openProcess, ProtocolSession, "tool.proceed"),
  ).toMatchObject({
    realExecutions: 1,
    output: { customer: "real customer" },
  }));
it("caps retained chunks while a consumer pauses", async () => {
  const c = openProcess(agent("fast"), {
    maxBufferedBytes: 262144,
    maxFrameBytes: 512,
  });
  const iterator = c.frames[Symbol.asyncIterator]();
  await iterator.next();
  expect(c.bufferedBytes).toBeLessThanOrEqual(262656);
  await iterator.return?.();
  await c.close();
});
it("rejects outbound pending-buffer overflow", async () => {
  const c = openProcess(agent("wait"), { maxBufferedBytes: 262144 });
  await expect(
    c.send({
      protocol: "causign/1",
      id: "hello",
      type: "hello",
      timestamp: "2026-09-30T00:00:00Z",
      payload: { supportedVersions: ["x".repeat(280000)] },
    }),
  ).rejects.toThrow("maxBufferedBytes");
  await c.close();
});
it("bounds ingress together with a nearly full unicode decoder", async () => {
  const c = openProcess(agent("fast-large"), {
    maxBufferedBytes: 262144,
    maxFrameBytes: 65536,
  });
  let count = 0;
  for await (const f of c.frames) {
    expect(f.message).toBeDefined();
    expect(c.bufferedBytes).toBeLessThanOrEqual(327680);
    count++;
    await new Promise((r) => setTimeout(r, 2));
  }
  expect(count).toBe(100);
});
it.each([{ maxMessages: 2 }, { maxTraceBytes: 250 }])(
  "terminates before handing off aggregate-limit diagnostic %o",
  async (limits) => {
    const message = {
      protocol: "causign/1",
      id: "persistent",
      type: "run.start",
      timestamp: "2026-09-30T00:00:00Z",
      runId: "r",
      payload: {
        input: "x".repeat(200),
        interceptions: [],
        approvalDecisions: [],
        limits: { scenarioTimeoutMs: 1000 },
      },
    };
    const script = `process.stdout.write(${JSON.stringify((JSON.stringify(message) + "\n").repeat(4))});setInterval(()=>{},1000);`;
    const c = openProcess(
      { command: process.execPath, args: ["-e", script] },
      limits,
    );
    const iterator = c.frames[Symbol.asyncIterator]();
    while (true) {
      const next = await iterator.next();
      expect(next.done).toBe(false);
      if (next.value?.diagnostic?.kind === "transport-limit") break;
    }
    // Do not advance/return the iterator or explicitly close before this assertion:
    // cleanup after the yielded error must not depend on another consumer action.
    expect(c.exit).toBeDefined();
    await c.close();
  },
);
