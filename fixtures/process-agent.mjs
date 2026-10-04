import { once } from "node:events";
import { createInterface } from "node:readline";
const [mode, ...args] = process.argv.slice(2);
const message = (input) => ({
  protocol: "causign/1",
  id: "fixture",
  timestamp: "2026-09-30T00:00:00Z",
  type: "run.start",
  runId: "r",
  payload: {
    input,
    interceptions: [],
    approvalDecisions: [],
    limits: { scenarioTimeoutMs: 1000 },
  },
});
const line = JSON.stringify(message("á🙂")) + "\n";
if (mode === "unicode") {
  for (const byte of Buffer.from(line)) {
    process.stdout.write(Buffer.from([byte]));
    await new Promise((r) => setTimeout(r, 1));
  }
} else if (mode === "args") console.log(JSON.stringify(message(args)));
else if (mode === "invalid") process.stdout.write("bad\n{}\n{partial");
else if (mode === "overflow") process.stdout.write("x".repeat(2000) + "\n");
else if (mode === "utf8") process.stdout.write(Buffer.from([0xc3, 0x28, 0x0a]));
else if (mode === "stderr") {
  process.stderr.write("x".repeat(100000));
  process.exitCode = 7;
} else if (mode === "fast") {
  for (let i = 0; i < 2000; i++) {
    if (!process.stdout.write(line)) await once(process.stdout, "drain");
  }
} else if (mode === "fast-large") {
  const large = JSON.stringify(message("á🙂".repeat(10000))) + "\n";
  for (let i = 0; i < 100; i++) {
    if (!process.stdout.write(large)) await once(process.stdout, "drain");
  }
} else if (mode === "wait") setInterval(() => {}, 1000);
else if (mode === "checkpoint") {
  let sequence = 0,
    runId,
    request,
    realExecutions = 0;
  const realTool = () => {
    realExecutions++;
    return { customer: "real customer" };
  };
  const emit = (type, payload, fields = {}) =>
    console.log(
      JSON.stringify({
        protocol: "causign/1",
        id: `adapter_${++sequence}`,
        type,
        timestamp: new Date().toISOString(),
        payload,
        ...fields,
      }),
    );
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const command = JSON.parse(line);
    if (command.type === "hello")
      emit(
        "adapter.ready",
        {
          adapter: { name: "raw-node-fixture", version: "1" },
          supportedVersions: ["causign/1"],
          capabilities: [
            "observe.output",
            "observe.toolRequests",
            "observe.toolExecution",
            "observe.toolResults",
            "intercept.tools",
          ],
        },
        { correlationId: command.id },
      );
    else if (command.type === "configure")
      emit("adapter.configured", {}, { correlationId: command.id });
    else if (command.type === "run.start") {
      runId = command.runId;
      emit("run.started", {}, { runId, correlationId: command.id });
      request = { runId, operationId: "lookup_1" };
      emit(
        "tool.requested",
        { name: "lookup", input: null, intercepted: true },
        request,
      );
    } else if (
      command.type === "tool.mock" ||
      command.type === "tool.proceed"
    ) {
      const execution = command.type === "tool.mock" ? "mock" : "real";
      if (execution === "real")
        emit("tool.started", { name: "lookup" }, request);
      const value =
        execution === "mock" ? command.payload.response.value : realTool();
      emit(
        "tool.completed",
        { name: "lookup", output: value, execution },
        request,
      );
      emit(
        "run.completed",
        { output: value, metadata: { realExecutions } },
        { runId },
      );
      lines.close();
      break;
    }
  }
}
