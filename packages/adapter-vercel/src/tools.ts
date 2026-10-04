import type { ToolSet } from "ai";
import { validateJsonValue } from "@causign/protocol";
import type { AgentContext } from "@causign/sdk";
export function validateTools(tools: ToolSet): void {
  for (const [name, tool] of Object.entries(tools)) {
    if (
      tool.type === "provider" ||
      typeof tool.execute !== "function" ||
      tool.needsApproval !== undefined ||
      tool.execute.constructor.name === "AsyncGeneratorFunction"
    )
      throw new Error(
        `Unsupported Vercel tool ${name}: requires local execute, no native approval or async iterable`,
      );
  }
}
export function wrapTools(tools: ToolSet, context: AgentContext): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        execute: async (input: unknown, options: any) =>
          context.callTool(name, validateJsonValue(input), async () => {
            context.signal.throwIfAborted();
            const output = await tool.execute!(input, options);
            if (
              output !== null &&
              typeof output === "object" &&
              Symbol.asyncIterator in output
            )
              throw new Error("Unsupported async iterable tool result");
            return validateJsonValue(output);
          }),
      },
    ]),
  );
}
