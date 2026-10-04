# Scenarios, mocks and evaluations

## Declarative SDK

```ts
import { agentTest, expect } from "@causign/sdk";

export default agentTest("lookup returns fixture", {
  id: "lookup-fixture",
  agent: "support",
  input: { customerId: "fake" },
  mocks: { lookup: { result: { customer: "Ada" } } },
  timeoutMs: 5000,
  assertions: [
    expect.tool("lookup").toHaveBeenRequested(),
    expect.tool("lookup").toHaveBeenMocked(),
    expect.tool("lookup").not.toHaveBeenExecuted(),
    expect.output().toEqual({ customer: "Ada" }),
  ],
});
```

Save as `lookup.causign.ts`. The configured agent must call `lookup` and return
its result. `agentTest` fills schema version, name, ID, mock list and assertion
IDs. Default ID is the name; scenario IDs are unique across discovery. Default
timeout is 30s. Inputs are plain JSON-compatible data: no functions, getters,
class instances, cycles or sparse arrays.

Export one default scenario, a default list, or a named `definitions` array.
`createScenarioCollector()` provides explicit validated registration through
`collector.add(scenario)` and snapshot `collector.definitions`. Empty collections
are ERROR; there is no ambient global registration. Direct declarative objects
follow [the scenario schema](../packages/protocol/schemas/scenario.schema.json).

## Matchers

| Expression                                           | Required evidence                               |
| ---------------------------------------------------- | ----------------------------------------------- |
| `expect.tool(name).toHaveBeenRequested()`            | Tool intent                                     |
| `.toHaveBeenExecuted()`                              | Real execution started                          |
| `.toHaveBeenCompleted()`                             | Successful real completion                      |
| `.toHaveBeenMocked()`                                | Successful mock result and interception support |
| `.toHaveBeenBlocked()`                               | Pre-execution rejection                         |
| `expect.approval().toHaveBeenRequested()`            | Approval request                                |
| `.toHaveBeenGranted()` / `.toHaveBeenRejected()`     | Approval resolution                             |
| `expect.output().toEqual(value)`                     | Exact JSON output equality                      |
| `expect.output().toSatisfy({ evaluator, criteria })` | Configured evaluator verdict                    |
| `expect.run().toHaveLatencyLessThan(ms)`             | Runner execution latency                        |
| `expect.run().toHaveCostLessThan(amount)`            | Explicit final USD cost                         |

Use `.not` to negate: `expect.tool('refund').not.toHaveBeenExecuted()`.
Capabilities are inferred from matchers/mocks; `requirements` adds explicit
requirements. A real failure proves execution but not successful completion.
Mock errors do not satisfy successful-mock assertions. Missing capabilities
produce INCOMPATIBLE before execution, not assertion FAIL.

## Mocks and approvals

```ts
mocks: {
  lookup: { result: { customer: 'Ada' } },
  unavailable: { error: { message: 'Fixture outage' } },
},
approvalDecisions: [{ decision: 'reject' }],
```

Each static mock has exactly one result or error and targets an exact tool name.
Duplicate names are invalid. The mock bypasses the real implementation; callback
mocks are outside this MVP. Approvals require explicit decisions; unresolved
approvals become ERROR and never grant by default. Mocking is not business
approval. The schema defines optional decision selectors.
`skipReason` skips without spawning an adapter. `metadata` accepts JSON values.

## Semantic evaluators

Register `citations: { module: './citations-evaluator.mjs' }` under config's
`evaluators`, then assert:

```ts
expect
  .output()
  .toSatisfy({ evaluator: "citations", criteria: "Include citation IDs" });
```

```js
// citations-evaluator.mjs
export function createEvaluator(options) {
  return {
    async evaluate(output, criteria) {
      const pass =
        Array.isArray(output?.citations) && output.citations.length > 0;
      return {
        status: pass ? "PASS" : "FAIL",
        explanation: pass ? "Citation IDs present" : "No citation IDs",
      };
    },
  };
}
```

Factories receive configured JSON options or null. Verdicts require PASS/FAIL/ERROR
and explanation; a finite numeric score is optional. Modules resolve from config
and load only during run. Exceptions/malformed verdicts become ERROR. Evidence
includes evaluator identity, config hash and configured provider/model metadata.
Scores are not confidence probabilities.

Latency covers `run.start` to terminal, including interception waits, excluding
negotiation, evaluator work and reporting. Tokens alone do not establish cost.
