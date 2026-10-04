# Adapter conformance

Implement `causign/1` against the packaged schemas and lifecycle rules in [protocol v1](protocol-v1.md). A generic process adapter needs no language SDK. `fixtures/python-agent.py` demonstrates standard-library interoperability; it is not a Python SDK. An arbitrary executable requires instrumentation before Causign can observe or control its tools.

Advertise only implemented coverage. Every promised observation family must report each exposed activity, while a run with no such activity needs no invented events. Partial observation is valid when the corresponding broader promises are absent. Interception must pause selected tool intent before effects and accept only an explicit valid decision. Cancel closes pending decisions and releases managed resources; application functions should honor their abort signal.

Run the executable conformance checks from the repository after a frozen install:

```sh
pnpm check:generated
pnpm build
pnpm exec vitest run packages/protocol/test/conformance.test.ts
pnpm exec vitest run packages/core/test
pnpm exec vitest run tests/acceptance/mvp.test.ts
pnpm test:packed
```

Replace the fixture agent configuration with your adapter executable/arguments and export serializable scenario definitions through `*.causign.ts` files. Test five families: structural protocol validation; compatible/incompatible capability negotiation; correlation and lifecycle; process IO/interruption/cleanup; assertion/report evidence. Include duplicate message IDs, duplicate decisions, wrong-direction frames, existing IDs with wrong trigger types, out-of-order concurrent operations, late commands, missing promised output/cost, partial JSONL, disconnects, timeout, and negatives on incomplete traces. Report adapter identity/version and deterministic test evidence. Passing runner checks does not prove that an adapter never hides activity.

The native Vercel integration is tested against `ai@7.0.127` using ToolLoopAgent and a deterministic MockLanguageModelV4. It supports output, messages, model calls, available usage, tool requests/execution/results/rejections, tool interception and cancellation. It does not advertise approval observation/control or cost observation; native `needsApproval`, provider tools and async iterable execution are rejected. Tokens are captured without price inference. Inputs are one prompt or nonempty user/assistant text messages. Unsupported fields and native tool behaviors fail closed. Live-provider tests are optional and do not replace deterministic acceptance; no provider secret is needed for the release suite.

Packed acceptance installs all five tarballs and the pinned AI SDK peer in a fresh consumer, with no workspace source imports or manually linked node_modules. It runs the installed CLI for the five domain scenarios, Python and Vercel. Workspace `pnpm test:coverage` also records quantitative package-source coverage. Keep traces and assertion references when diagnosing a failure; do not infer business approval from mock provenance, completion from execution start, or statistical confidence from a single semantic verdict.
