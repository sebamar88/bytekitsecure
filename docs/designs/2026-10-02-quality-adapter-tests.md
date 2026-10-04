# Adapter confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Cover untested Codex and Vercel behaviors with deterministic evidence assertions.
**Architecture:** Provider-specific tests establish behavior before subsequent formatting and shared discovery changes.
**Tech Stack:** TypeScript, Vitest/V8, pnpm 11.25.0, Node 24.21.0, oxlint, GitHub Actions.
**Spec:** docs/designs/2026-10-02-quality-hardening.md
**Execution:** Direct execution in this chat; approved and implemented; validation recorded in quality-validation.md.

## Global constraints

- Preserve protocol schema version 1, capabilities, fail-closed behavior, public plugin interfaces and the acyclic package graph.
- No package version changes, publishing, paid-provider calls, credentials, Paperclip, or unrelated source changes.
- Fresh branch from integrated main for each PR. Finish predecessor integration before the next PR; do not pile formatting onto behavioral diffs.
- Preserve unrelated working-tree edits; use targeted staging.
- Complete verification: `pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm test:packed`. Exit 0 means success; report platform skips and actual remote CI separately.
- Tests-only characterization may pass immediately; do not fabricate a production defect to get RED. Actual fixes require a failing regression first.

## Review focus

1. A valid profile beside malformed TOML retains the candidate and reports incomplete discovery (Task 1).
2. Duplicate native selectors preserve existing provider diagnostics (Task 1).
3. Events after completion or a native signal cannot produce successful Codex output (Task 2).
4. Tool rejection/mock never executes the real callback (Task 3).
5. Unknown usage in one step does not produce a fabricated aggregate (Task 3).

### Task 1: Baseline and Codex discovery

**Files:** Create `packages/adapter-codex/test/discovery.test.ts`; modify `packages/adapter-codex/test/adapter.test.ts` only to move existing discovery cases without duplication. Modify `src/discover.ts` only for a reproduced defect. Create `docs/designs/2026-10-02-quality-validation.md`.
**Interfaces:** Consumes `Discoverer.discover(source, context): Promise<DiscoveryReport>`, `SourceFile` and `candidateId`. Produces characterization tests and fresh baseline data.

- [x] Run full coverage baseline. Read adapter entries in `coverage/coverage-final.json` (coverage-summary may contain only totals). Record per-adapter branches/statements/functions and uncovered behavior.
- [x] Add table-driven cases using direct discovery contexts with explicit file paths/revisions: malformed base/profile TOML, invalid selector, non-string model/provider, duplicate basename in separate directories, instructions/unrelated files ignored, legacy warning, mixed valid/error input. Assert candidates, diagnostic codes/severity/source, complete, stable IDs and revisions.
- [x] Run `pnpm exec vitest run packages/adapter-codex/test/discovery.test.ts`. New characterization may pass; investigate mismatches against the supported contract before modifying behavior.
- [x] If a defect is found, record RED and minimally fix it, then run the complete Codex tests.
- [x] Commit `test: characterize Codex profile discovery`.

### Task 2: Codex event sequences

**Files:** Create `packages/adapter-codex/test/translate.test.ts`; move translator cases from adapter.test.ts; modify `src/translate.ts` only for reproduced defects.
**Interfaces:** Consumes `translateCodexResult(result: NativeResult): {text:string}`; native execution remains disabled.

- [x] Add independent cases for malformed JSON/null/array records, missing completion, duplicate turn start/final text, completion before text, post-terminal events, unknown item kind, exit 1/signal, CRLF and valid item updates. Assert success text or rejection, never fabricated output.
- [x] Run `pnpm exec vitest run packages/adapter-codex/test`. For unexpected acceptance, preserve the failing test and resolve the contract before a minimal fix.
- [x] Commit `test: cover Codex native event boundaries`.

### Task 3: Vercel lifecycle and usage

**Files:** Create `packages/adapter-vercel/test/events.test.ts`, `tools.test.ts`, and `fixtures.ts`; modify adapter.test.ts only to share its harness. Modify src/events.ts, tools.ts or index.ts only for reproduced defects.
**Interfaces:** Consumes `observeModel(model,context)`, `wrapTools(tools,context)`, `validateTools(tools)` and `createVercelAdapter(options): AgentHandler`. Harness returns context, recorded events and AbortController.

- [x] Read existing cases first; avoid duplicating model failure, basic cancellation and simple mock coverage.
- [x] Add controlled multi-step usage tests: known→unknown input retains known output but omits aggregate input/total; reverse dimensions; known zero remains zero.
- [x] Add reject/mock assertions at the actual bridge boundary: real callback uncalled, no tool.started for mock/reject, execution mock for completion, rejection evidence distinct. Extend existing bridge fixture with reject and use event-driven waits with a bounded failure timeout.
- [x] Add invalid JSON output, pre-aborted execution, cancellation while awaiting model/tool, maxSteps 0/fraction, and invalid message roles/fields. Assert lifecycle evidence and no subsequent side effects; use deferred promises rather than sleeps.
- [x] Run Vercel tests. Fix only behavior pinned by failing tests.
- [x] Run complete verification; record new per-adapter coverage and remaining untested branches in validation report.
- [x] Commit `test: strengthen Vercel lifecycle evidence`; create PR 1 with validation and any actual fixes.
