import { wrapLanguageModel } from "ai";
import type { AgentContext } from "@causign/sdk";
import type { Usage } from "@causign/protocol";
export type VercelModel = Parameters<typeof wrapLanguageModel>[0]["model"];
export function observeModel(
  model: VercelModel,
  context: AgentContext,
): { model: ReturnType<typeof wrapLanguageModel>; reportUsage(): void } {
  let inputTokens = 0,
    outputTokens = 0,
    inputKnown = true,
    outputKnown = true;
  const wrapped = wrapLanguageModel({
    model,
    middleware: {
      wrapGenerate: async ({ doGenerate, model }) => {
        const operation = context.modelStarted({
          model: model.modelId,
          provider: model.provider,
        });
        let result;
        try {
          result = await doGenerate();
        } catch (error) {
          if (!context.signal.aborted)
            context.modelFailed(
              operation,
              error instanceof Error ? error.message : String(error),
            );
          throw error;
        }
        const usage: Usage = {};
        if (result.usage.inputTokens.total !== undefined) {
          usage.inputTokens = result.usage.inputTokens.total;
          inputTokens += usage.inputTokens;
        } else inputKnown = false;
        if (result.usage.outputTokens.total !== undefined) {
          usage.outputTokens = result.usage.outputTokens.total;
          outputTokens += usage.outputTokens;
        } else outputKnown = false;
        if (usage.inputTokens !== undefined && usage.outputTokens !== undefined)
          usage.totalTokens = usage.inputTokens + usage.outputTokens;
        context.modelCompleted(operation, {
          output: result.content
            .filter((p) => p.type === "text")
            .map((p) => p.text),
          usage,
        });
        return result;
      },
    },
  });
  return {
    model: wrapped,
    reportUsage() {
      context.reportUsage({
        ...(inputKnown ? { inputTokens } : {}),
        ...(outputKnown ? { outputTokens } : {}),
        ...(inputKnown && outputKnown
          ? { totalTokens: inputTokens + outputTokens }
          : {}),
      });
    },
  };
}
