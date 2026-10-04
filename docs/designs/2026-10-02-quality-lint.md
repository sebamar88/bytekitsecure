# Targeted lint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Increase lint signal with selected maintainability rules and explicit exceptions.
**Architecture:** Keep correctness and add verified installed-oxlint rules based on real findings, avoiding blanket categories.
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

1. Async callbacks that lose errors are considered against supported non-type-aware rules (Task 1).
2. Intentional explicit any in SDK fixtures is not globally suppressed (Task 1).
3. Generated code remains under generator checks (Task 1).
4. Rule fixes preserve mocks/cancellation evidence (Task 1).
5. Configuration rejects warnings in both CI paths (Task 1).

### Task 1: Rule audit and enforcement

**Files:** .oxlintrc.json, docs/development.md, minimal affected src/test files; regression tests in owning package.
**Interfaces:** No runtime API changes; `pnpm lint` remains oxlint --deny-warnings.

- [ ] After PR 2 is integrated, inspect `pnpm exec oxlint --help` and the installed rule inventory/schema. Evaluate supported suspicious-category rules, eqeqeq, no-var, prefer-const and applicable promise rules; do not assume identifiers/plugins exist.
- [ ] Run candidate rules without changing permanent config. Record findings, supported rule identifiers and false positives in development docs; choose only rules with useful enforceable behavior.
- [ ] Add selected rules as errors, retaining correctness and current generated/build exclusions. Run lint to capture violations before fixes.
- [ ] Fix each violation narrowly. Add failing behavioral regressions before semantic fixes; purely syntactic changes require suite verification, not mirror tests.
- [ ] For intentional exceptions use line-local documented suppressions; no package-wide disable and no weakening correctness.
- [ ] Run format:check and complete verification. Commit `chore: enforce targeted lint rules`; create PR 3 listing exact rules and rationale.
