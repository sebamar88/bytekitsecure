# Shared discovery collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Reduce duplicated result bookkeeping without changing provider discovery semantics.
**Architecture:** Runtime owns file iteration and result aggregation; provider callbacks retain parser, selector, candidate and diagnostic logic.
**Tech Stack:** TypeScript, Vitest/V8, pnpm 11.25.0, Node 24.21.0, oxlint, GitHub Actions.
**Spec:** docs/designs/2026-10-02-quality-hardening.md
**Execution:** Direct execution in this chat; written plan awaiting user review.

## Global constraints

- Preserve protocol schema version 1, capabilities, fail-closed behavior, public plugin interfaces and the acyclic package graph.
- No package version changes, publishing, paid-provider calls, credentials, Paperclip, or unrelated source changes.
- Fresh branch from integrated main for each PR. Finish predecessor integration before the next PR; do not pile formatting onto behavioral diffs.
- Preserve unrelated working-tree edits; use targeted staging.
- Complete verification: `pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm test:packed`. Exit 0 means success; report platform skips and actual remote CI separately.
- Tests-only characterization may pass immediately; do not fabricate a production defect to get RED. Actual fixes require a failing regression first.

## Review focus

1. Mixed valid/error files preserve partial candidates and complete false (Task 1/2).
2. Warning-only results stay complete true (Task 1/2).
3. Duplicate policies remain different for Claude/Codex (Task 2).
4. Candidate ordering, IDs and revisions remain identical (Task 2).
5. A thrown callback does not silently become complete success (Task 1).

### Task 1: Shared result collector

**Files:** Create packages/runtime/src/file-discovery.ts and packages/runtime/test/file-discovery.test.ts; modify packages/runtime/src/index.ts.
**Interfaces:** Additive exported helper:
`collectFileDiscovery(files: readonly SourceFile[], inspect: (file: SourceFile) => {candidates: AgentCandidate[]; diagnostics: Diagnostic[]}): DiscoveryReport`.
Callback returns empty arrays for ignored files; owns provider error conversion; uncaught callback errors propagate. Collector appends results in file order and computes complete from severity error only.

- [ ] Add tests for empty input, ignored entries, warning-only complete true, mixed candidates/errors complete false, ordered candidates/diagnostics, and callback throw propagation.
- [ ] Run `pnpm exec vitest run packages/runtime/test/file-discovery.test.ts`; expect missing-helper RED.
- [ ] Implement exact helper and export; no YAML/TOML/runtime provider switches.
- [ ] Rerun tests GREEN. Commit `refactor: add shared file discovery collector`.

### Task 2: Provider migration and compatibility

**Files:** packages/adapter-claude-code/src/discover.ts, packages/adapter-codex/src/discover.ts, their discovery tests, docs/agent-discovery.md.
**Interfaces:** Consumes helper from Task 1; existing Discoverer and RuntimePlugin signatures unchanged. Selector sets remain local to each discovery invocation.

- [ ] Add exact characterization assertions for duplicate provider messages/codes, model metadata, partial candidate ordering, complete and stable IDs/revisions; reuse PR 1 cases.
- [ ] Capture results before migration, including Claude unknown metadata warning and Codex legacy base-file behavior.
- [ ] Migrate each provider separately, returning zero-or-more candidates/diagnostics per inspected file. Keep try/catch and duplicate diagnostics inside provider callbacks.
- [ ] Run runtime and both provider suites after each migration; compare complete returned reports rather than only counts.
- [ ] Document the additive collector export and preserved trusted-code plugin boundary.
- [ ] Run format:check and complete verification, including external-plugin packed discovery. Inspect package dependency graph: runtime must not gain YAML/TOML dependencies.
- [ ] Commit `refactor: share adapter discovery result collection`; create PR 4 with compatibility evidence.
