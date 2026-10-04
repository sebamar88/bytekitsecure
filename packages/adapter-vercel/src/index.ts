import {
  ToolLoopAgent,
  isStepCount,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { validateJsonValue, type JsonValue } from "@causign/protocol";
import type { AgentHandler, BridgeOptions } from "@causign/sdk";
import { observeModel, type VercelModel } from "./events.js";
import { validateTools, wrapTools } from "./tools.js";
export const vercelCapabilities = [
  "observe.output",
  "observe.messages",
  "observe.modelCalls",
  "observe.usage",
  "observe.toolRequests",
  "observe.toolExecution",
  "observe.toolResults",
  "observe.toolRejections",
  "intercept.tools",
  "control.cancel",
] as const;
export const vercelBridgeOptions = {
  name: "causign-vercel",
  version: "0.1.1",
  observations: ["observe.messages", "observe.modelCalls", "observe.usage"],
  controlApprovals: false,
  observeApprovals: false,
} as const satisfies BridgeOptions;
export interface VercelAdapterOptions {
  model: VercelModel;
  tools?: ToolSet;
  instructions?: string;
  maxSteps?: number;
}
function readInput(
  input: JsonValue,
): { prompt: string } | { messages: ModelMessage[] } {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw Error("Expected object containing prompt or text messages");
  if (Object.keys(input).some((k) => k !== "prompt" && k !== "messages"))
    throw Error("Unsupported Vercel input field");
  if (typeof input.prompt === "string" && input.messages === undefined)
    return { prompt: input.prompt };
  if (
    input.prompt === undefined &&
    Array.isArray(input.messages) &&
    input.messages.length > 0
  ) {
    const messages = input.messages.map((m) => {
      if (
        m === null ||
        typeof m !== "object" ||
        Array.isArray(m) ||
        Object.keys(m).some((k) => k !== "role" && k !== "content") ||
        !["user", "assistant"].includes(String(m.role)) ||
        typeof m.content !== "string"
      )
        throw Error("Only user/assistant text messages are supported");
      return { role: m.role, content: m.content } as ModelMessage;
    });
    return { messages };
  }
  throw Error("Provide exactly one prompt or nonempty text messages");
}
export function createVercelAdapter(
  options: VercelAdapterOptions,
): AgentHandler {
  const tools = options.tools ?? {};
  validateTools(tools);
  const maxSteps = options.maxSteps ?? 20;
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1)
    throw Error("maxSteps must be a positive integer");
  return async (input, context) => {
    const prompt = readInput(input);
    context.signal.throwIfAborted();
    if (options.instructions)
      context.message({ role: "system", content: options.instructions });
    if ("prompt" in prompt)
      context.message({ role: "user", content: prompt.prompt });
    else
      for (const message of prompt.messages)
        context.message({
          role: message.role,
          content: validateJsonValue(message.content),
        });
    const observed = observeModel(options.model, context);
    const agent = new ToolLoopAgent({
      model: observed.model,
      tools: wrapTools(tools, context),
      instructions: options.instructions,
      stopWhen: isStepCount(maxSteps),
      maxRetries: 0,
      onStepEnd: (step) => {
        // Each step contains its own response messages; strip SDK optional undefined fields.
        for (const message of step.response.messages) {
          context.message({
            role: message.role,
            content: validateJsonValue(
              JSON.parse(JSON.stringify(message.content)),
            ),
          });
        }
      },
    });
    const result = await agent.generate({
      ...prompt,
      abortSignal: context.signal,
    });
    observed.reportUsage();
    return { text: result.text };
  };
}
