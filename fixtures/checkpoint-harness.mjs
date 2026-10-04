import { resolve } from "node:path";
export async function checkpoint(
  openProcess,
  ProtocolSession,
  decision = "tool.mock",
) {
  const connection = openProcess(
    {
      command: process.execPath,
      args: [resolve("fixtures/process-agent.mjs"), "checkpoint"],
    },
    {},
  );
  const session = new ProtocolSession();
  const events = [];
  let index = 0;
  const send = async (type, payload, fields = {}) => {
    const message = {
      protocol: "causign/1",
      id: `runner_${++index}`,
      type,
      timestamp: new Date().toISOString(),
      payload,
      ...fields,
    };
    session.accept(message, "runner");
    events.push(message);
    await connection.send(message);
  };
  try {
    await send("hello", { supportedVersions: ["causign/1"] });
    for await (const frame of connection.frames) {
      if (!frame.message) throw new Error(JSON.stringify(frame));
      const message = frame.message;
      session.accept(message, "adapter");
      events.push(message);
      if (message.type === "adapter.ready")
        await send("configure", { protocol: "causign/1" });
      else if (message.type === "adapter.configured")
        await send(
          "run.start",
          {
            input: null,
            interceptions: [
              {
                type: "tool",
                name: "lookup",
                response: {
                  kind: "result",
                  value: { customer: "mock customer" },
                },
              },
            ],
            approvalDecisions: [],
            limits: { scenarioTimeoutMs: 1000 },
          },
          { runId: "checkpoint_run" },
        );
      else if (message.type === "tool.requested")
        await send(
          decision,
          decision === "tool.mock"
            ? {
                response: {
                  kind: "result",
                  value: { customer: "mock customer" },
                },
              }
            : {},
          {
            runId: message.runId,
            operationId: message.operationId,
            correlationId: message.id,
          },
        );
      else if (message.type === "run.completed")
        return {
          types: events.map((m) => m.type),
          output: message.payload.output,
          realExecutions: message.payload.metadata.realExecutions,
          events,
        };
    }
    throw new Error("Checkpoint ended without run.completed");
  } finally {
    await connection.close();
  }
}
