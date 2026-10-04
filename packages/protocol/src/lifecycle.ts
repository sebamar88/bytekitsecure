import type {
  ProtocolMessage,
  RunStart,
  ToolProceed,
  ToolMockCommand,
  ToolReject,
  ApprovalResolve,
} from "./generated.js";
import { isDeepStrictEqual } from "node:util";
import { validateMessage } from "./validate.js";
import { negotiate } from "./capabilities.js";
import {
  assertProtocol,
  validateCorrelation,
  validateDirection,
  type Direction,
} from "./correlations.js";
type Operation = {
  family: "tool" | "approval" | "model";
  state: "pending" | "started" | "terminal";
  name?: string;
  requestId?: string;
  intercepted?: boolean;
  decision?: ToolProceed | ToolMockCommand | ToolReject | ApprovalResolve;
};
type Run = {
  start: RunStart;
  started: boolean;
  state: "starting" | "active" | "cancelling" | "terminal";
  operations: Map<string, Operation>;
};
export class ProtocolSession {
  private messages = new Map<string, ProtocolMessage>();
  private runs = new Map<string, Run>();
  private handshake: "new" | "hello" | "ready" | "configuring" | "configured" =
    "new";
  private capabilities = new Set<string>();
  private supportedVersions: string[] = [];
  private helloId?: string;
  private configureId?: string;
  accept(message: ProtocolMessage, direction: Direction): void {
    validateMessage(message);
    validateDirection(message, direction);
    assertProtocol(!this.messages.has(message.id), "Duplicate message ID");
    validateCorrelation(message, this.messages);
    // Apply to a copy: a rejected frame cannot consume IDs or alter lifecycle.
    const snapshot = structuredClone(message);
    if (!("runId" in snapshot)) this.acceptHandshake(snapshot);
    else if (snapshot.type === "run.start") this.startRun(snapshot);
    else {
      const original = this.runs.get(snapshot.runId);
      assertProtocol(original, "Unknown run");
      assertProtocol(original.state !== "terminal", "Run is terminal");
      const run = structuredClone(original);
      this.acceptRun(run, snapshot);
      this.runs.set(snapshot.runId, run);
    }
    this.messages.set(snapshot.id, snapshot);
  }
  finalizeInterrupted(runId: string): void {
    const run = this.runs.get(runId);
    assertProtocol(run, "Unknown run");
    if (run.state === "terminal") return;
    this.closeOperations(run);
    run.state = "terminal";
  }
  private acceptHandshake(
    message: Extract<
      ProtocolMessage,
      { type: "hello" | "adapter.ready" | "configure" | "adapter.configured" }
    >,
  ): void {
    switch (message.type) {
      case "hello":
        assertProtocol(this.handshake === "new", "Unexpected hello");
        this.supportedVersions = [...message.payload.supportedVersions];
        this.helloId = message.id;
        this.handshake = "hello";
        break;
      case "adapter.ready": {
        assertProtocol(
          this.handshake === "hello" && message.correlationId === this.helloId,
          "Unexpected adapter.ready",
        );
        const result = negotiate(message, []);
        assertProtocol(
          result.status === "READY",
          result.status === "READY" ? "" : result.reason,
        );
        assertProtocol(
          this.supportedVersions.includes(result.protocol),
          "No common protocol version",
        );
        this.capabilities = new Set(result.capabilities);
        this.handshake = "ready";
        break;
      }
      case "configure":
        assertProtocol(this.handshake === "ready", "Unexpected configure");
        this.configureId = message.id;
        this.handshake = "configuring";
        break;
      case "adapter.configured":
        assertProtocol(
          this.handshake === "configuring" &&
            message.correlationId === this.configureId,
          "Unexpected adapter.configured",
        );
        this.handshake = "configured";
        break;
    }
  }
  private startRun(message: RunStart): void {
    assertProtocol(
      this.handshake === "configured",
      "Configure acknowledgement required",
    );
    assertProtocol(!this.runs.has(message.runId), "Duplicate run ID");
    if (message.payload.interceptions.length)
      this.requireCapability("intercept.tools");
    if (message.payload.approvalDecisions.length)
      this.requireCapability("control.approvals");
    assertProtocol(
      new Set(message.payload.interceptions.map((mock) => mock.name)).size ===
        message.payload.interceptions.length,
      "Duplicate interceptions",
    );
    this.runs.set(message.runId, {
      start: message,
      started: false,
      state: "starting",
      operations: new Map(),
    });
  }
  private acceptRun(
    run: Run,
    message: Extract<ProtocolMessage, { runId: string }>,
  ): void {
    if (message.type === "run.started") {
      assertProtocol(
        run.state === "starting" && message.correlationId === run.start.id,
        "Unexpected run.started",
      );
      run.started = true;
      run.state = "active";
      return;
    }
    if (message.type === "run.errored") {
      this.closeOperations(run);
      run.state = "terminal";
      return;
    }
    if (message.type === "run.cancel") {
      this.requireCapability("control.cancel");
      assertProtocol(
        run.state === "active" || run.state === "starting",
        "Already cancelling",
      );
      this.closeOperations(run);
      run.state = "cancelling";
      return;
    }
    assertProtocol(
      run.state === "active" || run.state === "cancelling",
      "Run has not started",
    );
    if (
      message.type === "run.completed" ||
      message.type === "run.failed" ||
      message.type === "run.cancelled"
    ) {
      if (message.type !== "run.cancelled")
        assertProtocol(run.started, "Cannot complete a run that never started");
      if (
        message.type === "run.completed" &&
        this.capabilities.has("observe.output")
      )
        assertProtocol(
          Object.hasOwn(message.payload, "output"),
          "Missing final output",
        );
      if (
        message.type !== "run.cancelled" &&
        this.capabilities.has("observe.cost")
      )
        assertProtocol(
          message.payload.usage?.cost?.currency === "USD",
          "Missing complete final USD cost",
        );
      if (message.type !== "run.cancelled")
        for (const op of run.operations.values()) {
          if (
            (op.family === "tool" &&
              this.capabilities.has("observe.toolResults")) ||
            op.family === "approval" ||
            op.family === "model"
          )
            assertProtocol(
              op.state === "terminal",
              "Unresolved operation on complete run",
            );
        }
      this.closeOperations(run);
      run.state = "terminal";
      return;
    }
    assertProtocol(run.state === "active", "Run is cancelling");
    if (message.type === "message.created") {
      this.requireCapability("observe.messages");
      return;
    }
    assertProtocol("operationId" in message, "Expected operation message");
    if (message.type.startsWith("tool."))
      this.acceptTool(
        run,
        message as Extract<ProtocolMessage, { type: `tool.${string}` }>,
      );
    else if (message.type.startsWith("approval."))
      this.acceptApproval(
        run,
        message as Extract<ProtocolMessage, { type: `approval.${string}` }>,
      );
    else
      this.acceptModel(
        run,
        message as Extract<ProtocolMessage, { type: `model.${string}` }>,
      );
  }
  private acceptTool(
    run: Run,
    message: Extract<ProtocolMessage, { type: `tool.${string}` }>,
  ): void {
    let op = run.operations.get(message.operationId);
    if (message.type === "tool.requested") {
      this.requireCapability("observe.toolRequests");
      assertProtocol(!op, "Duplicate operation ID");
      const selected = run.start.payload.interceptions.some(
        (mock) => mock.name === message.payload.name,
      );
      assertProtocol(
        message.payload.intercepted === selected,
        "Interception does not match run selection",
      );
      if (selected) this.requireCapability("intercept.tools");
      run.operations.set(message.operationId, {
        family: "tool",
        state: "pending",
        name: message.payload.name,
        requestId: message.id,
        intercepted: selected,
      });
      return;
    }
    if (
      message.type === "tool.proceed" ||
      message.type === "tool.mock" ||
      message.type === "tool.reject"
    ) {
      this.requireCapability("intercept.tools");
      assertProtocol(
        op?.family === "tool" && op.state === "pending" && op.intercepted,
        "No pending intercepted operation",
      );
      assertProtocol(
        op.requestId === message.correlationId && !op.decision,
        "Invalid or duplicate tool decision",
      );
      op.decision = message;
      return;
    }
    const capability =
      message.type === "tool.started"
        ? "observe.toolExecution"
        : message.type === "tool.rejected"
          ? "observe.toolRejections"
          : "observe.toolResults";
    this.requireCapability(capability);
    if (!op) {
      assertProtocol(
        !this.capabilities.has("observe.toolRequests"),
        "Missing promised request",
      );
      assertProtocol(
        !run.start.payload.interceptions.some(
          (mock) => mock.name === message.payload.name,
        ),
        "Selected operation has no intercepted request",
      );
      op = {
        family: "tool",
        state: "pending",
        name: message.payload.name,
        intercepted: false,
      };
      run.operations.set(message.operationId, op);
    }
    assertProtocol(
      op.family === "tool" && op.state !== "terminal",
      "Wrong family or terminal operation",
    );
    assertProtocol(op.name === message.payload.name, "Tool name changed");
    const decision = op.decision;
    if (message.type === "tool.started") {
      assertProtocol(op.state === "pending", "Tool already started");
      assertProtocol(
        !op.intercepted || decision?.type === "tool.proceed",
        "Explicit proceed required",
      );
      op.state = "started";
      return;
    }
    if (message.type === "tool.rejected") {
      assertProtocol(
        op.state === "pending",
        "Rejection must precede execution",
      );
      if (op.intercepted)
        assertProtocol(
          decision?.type === "tool.reject",
          "Rejection requires reject decision",
        );
      if (decision?.type === "tool.reject")
        assertProtocol(
          decision.payload.source === message.payload.source &&
            decision.payload.reason === message.payload.reason,
          "Rejection does not match decision",
        );
      if (message.payload.source === "causign")
        assertProtocol(
          decision?.type === "tool.reject",
          "Missing runner rejection",
        );
    } else {
      if (message.payload.execution === "mock") {
        assertProtocol(
          decision?.type === "tool.mock" && op.state === "pending",
          "Mock requires pending mock decision",
        );
        assertProtocol(
          decision.payload.response.kind ===
            (message.type === "tool.completed" ? "result" : "error"),
          "Mock outcome differs from decision",
        );
        if (message.type === "tool.completed")
          assertProtocol(
            isDeepStrictEqual(
              message.payload.output,
              decision.payload.response.value,
            ),
            "Mock output differs from supplied result",
          );
      } else {
        assertProtocol(
          !op.intercepted || decision?.type === "tool.proceed",
          "Real result requires proceed",
        );
        if (this.capabilities.has("observe.toolExecution"))
          assertProtocol(
            op.state === "started",
            "Missing promised execution start",
          );
      }
    }
    op.state = "terminal";
  }
  private acceptApproval(
    run: Run,
    message: Extract<ProtocolMessage, { type: `approval.${string}` }>,
  ): void {
    this.requireCapability("observe.approvals");
    const op = run.operations.get(message.operationId);
    if (message.type === "approval.requested") {
      assertProtocol(!op, "Duplicate operation ID");
      run.operations.set(message.operationId, {
        family: "approval",
        state: "pending",
        requestId: message.id,
      });
      return;
    }
    assertProtocol(
      op?.family === "approval" && op.state === "pending",
      "No pending approval",
    );
    if (message.type === "approval.resolve") {
      this.requireCapability("control.approvals");
      assertProtocol(
        !op.decision && op.requestId === message.correlationId,
        "Invalid or duplicate approval decision",
      );
      op.decision = message;
    } else {
      if (op.decision) {
        assertProtocol(
          op.decision.type === "approval.resolve" &&
            op.decision.payload.decision === message.payload.decision,
          "Approval completion differs from decision",
        );
      }
      op.state = "terminal";
    }
  }
  private acceptModel(
    run: Run,
    message: Extract<ProtocolMessage, { type: `model.${string}` }>,
  ): void {
    this.requireCapability("observe.modelCalls");
    const op = run.operations.get(message.operationId);
    if (message.type === "model.started") {
      assertProtocol(!op, "Duplicate operation ID");
      run.operations.set(message.operationId, {
        family: "model",
        state: "started",
      });
    } else {
      assertProtocol(
        op?.family === "model" && op.state === "started",
        "No started model operation",
      );
      op.state = "terminal";
    }
  }
  private closeOperations(run: Run): void {
    for (const op of run.operations.values()) op.state = "terminal";
  }
  private requireCapability(capability: string): void {
    assertProtocol(
      this.capabilities.has(capability),
      `Capability not negotiated: ${capability}`,
    );
  }
}
