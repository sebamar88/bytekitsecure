# Vercel AI SDK adapter

Compatibility is deliberately narrow: `ai@7.0.127` is the exact peer and deterministic test version. Earlier or later releases are not claimed compatible. No provider package, live credentials, model catalog, or pricing configuration is required for the example.

```ts
import { serveAgent } from "@causign/sdk";
import {
  createVercelAdapter,
  vercelBridgeOptions,
} from "@causign/adapter-vercel";
// model and tools belong to the application.
await serveAgent(createVercelAdapter({ model, tools }), vercelBridgeOptions);
```

Input is declarative JSON: `{ "prompt": "hello" }`, or `{ "messages": [{ "role": "user", "content": "hello" }] }`. Exactly one field is required; messages accept user/assistant text only. Application options are `model` (a model object accepted by `wrapLanguageModel`), `tools`, optional `instructions`, and positive `maxSteps` (default 20). Output is `{ text: string }`. The handler runs the installed `ToolLoopAgent.generate`, with `isStepCount` and retries disabled. Provider errors are rethrown unchanged. AI SDK normally represents local tool exceptions as tool-error messages and can continue to a final answer; the Causign trace still records the real tool failure.

| Capability                                                                                  | Implemented evidence                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| observe.output                                                                              | Final generated text returned to serveAgent                                                                                                              |
| observe.messages                                                                            | Submitted instructions/text input and each onStepEnd response.messages; SDK optional undefined fields removed for JSON transport                         |
| observe.modelCalls                                                                          | wrapLanguageModel.wrapGenerate surrounds each actual provider doGenerate call; model.completed precedes tool execution; failures preserve provider error |
| observe.usage                                                                               | Provider-reported input/output token totals summed across successful model calls; unknown fields omitted                                                 |
| observe.toolRequests / observe.toolExecution / observe.toolResults / observe.toolRejections | AgentContext.callTool wraps local execute; selected mocks/rejections pause before execute                                                                |
| intercept.tools                                                                             | Runner decision determines mock/proceed/reject; a mock never invokes execute                                                                             |
| control.cancel                                                                              | Bridge cancellation and provider abortSignal; tools receive original AI SDK execution options including abortSignal                                      |
| observe.cost                                                                                | Unsupported; no price estimation or fabricated USD cost                                                                                                  |
| observe.approvals / control.approvals                                                       | Unsupported native integration; bridge helper disables both                                                                                              |

`vercelCapabilities` is the exact advertised set when using `vercelBridgeOptions`. Always use that helper: generic serveAgent defaults have broader approval capabilities for custom handlers. The SDK adds `observeApprovals: false` to prevent approval observation/control promises for this adapter; inconsistent explicit control plus disabled observation is rejected. Disabled requestApproval fails before emitting an approval event. The adapter does not call approval APIs.

Local tools must have an execute function, JSON arguments/results, and no needsApproval setting (including false). Provider tools, declaration-only tools, native approvals, and async generator execute functions fail at adapter creation. Functions that return async iterables fail as real tool errors; no iterable is forwarded. Application tool definitions are copied without mutation and original execution arguments/options are preserved. Interception covers execute, not application callbacks such as input notifications or schema transforms: these must be free of tool side effects. Cooperative cancellation cannot stop an application function that ignores its signal. After bridge cancellation, no late model terminal or output is emitted.

No dynamic prompt mapper, provider selection, model interception, streaming API, native approval resolver, cost estimator, or replay mechanism is exposed. No protocol coverage is inferred from the framework name. Missing cost, approval, or partial required observation capabilities produce INCOMPATIBLE during ordinary engine negotiation.

Verified installed sources: `ai/src/agent/tool-loop-agent.ts`, `ai/src/middleware/wrap-language-model.ts`, `ai/src/generate-text/generate-text.ts`, `ai/src/generate-text/generate-text-events.ts`, `ai/src/generate-text/to-response-messages.ts`, `ai/src/test/mock-language-model-v4.ts`; bundled docs under `ai/docs/`. onStepStart is before the provider but represents step intent; onStepEnd follows tool execution, so neither is falsely used as provider completion timing. The middleware directly brackets provider execution; onStepEnd is used only for messages.

Run the deterministic example after building: `node examples/vercel/agent.mjs`. It speaks JSONL on stdin/stdout and uses ai/test.MockLanguageModelV4, never a network provider. The companion config/scenario can be loaded by the Causign CLI.
