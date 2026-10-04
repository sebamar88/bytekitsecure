---
name: causign
description: Use when configuring Causign scenarios, instrumenting an agent adapter, interpreting Causign test evidence, or integrating its CLI into CI.
---

# Causign

Use the Causign CLI to test instrumented agents and retain evidence for each
claim. Causign speaks a language-neutral JSONL protocol; an agent needs a
compatible adapter even when its framework has no dedicated integration.

## Locate the distribution

Inspect the project's installed packages, scripts and Causign configuration.
Use its existing package manager. With an installed `@causign/cli`, run
`pnpm exec causign` (or the project's equivalent). In the Causign source
workspace, build first and invoke `node packages/cli/dist/bin.js`.
Do not assume the npm packages have been published. For local tarball setup,
read the source repository's README and `scripts/packed-smoke.mjs`.

## Configure and run

- `causign init` creates a harmless starter and refuses existing destinations.
- `causign inspect [files/globs] --config path` prepares scenarios without
  starting agents. Compatibility remains unverified until negotiation.
- `causign run [files/globs] --config path --output-dir path --verbose`
  executes scenarios and saves plans, traces and `results.json`.

Configuration defaults to `causign.config.ts`; discovery uses
`**/*.causign.ts`. Each module exports a default scenario/list or a named
`definitions` array. Agent working directories and evaluator modules resolve
from the configuration directory. Configuration and scenario imports execute
local code; inspect and process isolation are not security sandboxes.

Start from `init` or a matching maintained example rather than inventing schema
fields or assertion names. In the source repository, consult
`packages/cli/README.md`, `examples/README.md`, and the schemas in
`packages/protocol` for exact syntax. Prefer deterministic fixtures and static
mocks for regression tests; live model tests need explicit provider setup.

## Interpret evidence

| Observation                               | Meaning                                               |
| ----------------------------------------- | ----------------------------------------------------- |
| `tool.requested`                          | Intent, before execution                              |
| `tool.started`                            | Real execution began                                  |
| `tool.completed` with `execution: "mock"` | Mock result; real tool did not run                    |
| `tool.rejected`                           | Rejection; inspect its source and operation reference |

Capabilities use closed-world semantics: undeclared means unsupported. A
missing required capability produces INCOMPATIBLE, not a failed assertion.
Absence in an incomplete trace cannot establish a negative security claim;
report NOT_EVALUATED where appropriate. An observed contrary fact can still
fail a negative assertion. Intercepted operations require an explicit decision
and must fail closed on timeout or disconnect.

When explaining a result, cite the assertion's expected/observed/reason and
its trace message or metric references. Preserve runId/operationId identity.
Keep ERROR (protocol/infrastructure) distinct from FAIL (behavior).

## CI

Run the same installed CLI command used locally. Preserve its exit code:
PASS/SKIP 0, FAIL 1, ERROR 2, INCOMPATIBLE 3, interruption 130. Suite precedence
is ERROR > INCOMPATIBLE > FAIL. Upload the configured results directory even
when execution fails; hidden `.causign` artifacts need explicit inclusion.
Use the project's lockfile and supported runtimes. Add provider credentials
only for scenarios that need them. Report local verification separately from
an observed remote CI run.
