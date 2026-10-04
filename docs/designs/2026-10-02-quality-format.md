# Consistent formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Expand dense maintained code without behavioral changes.
**Architecture:** A standalone mechanical PR adds a pinned formatter and CI enforcement, preserving generated outputs.
**Tech Stack:** TypeScript, Vitest/V8, pnpm 11.25.0, Node 24.21.0, oxlint, GitHub Actions.
**Spec:** docs/designs/2026-10-02-quality-hardening.md
**Execution:** Direct execution in this chat; approved and implemented; see 2026-10-03-quality-format-validation.md.

## Global constraints

- Preserve protocol schema version 1, capabilities, fail-closed behavior, public plugin interfaces and the acyclic package graph.
- No package version changes, publishing, paid-provider calls, credentials, Paperclip, or unrelated source changes.
- Fresh branch from integrated main for each PR. Finish predecessor integration before the next PR; do not pile formatting onto behavioral diffs.
- Preserve unrelated working-tree edits; use targeted staging.
- Complete verification: `pnpm check:generated`, `pnpm lint`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm test:packed`. Exit 0 means success; report platform skips and actual remote CI separately.
- Tests-only characterization may pass immediately; do not fabricate a production defect to get RED. Actual fixes require a failing regression first.

## Review focus

1. Generated protocol files stay unchanged (Task 1).
2. Lockfiles/runtime artifacts are excluded (Task 1).
3. Formatter rewrites do not reorder execution or imports (Task 1).
4. Windows line endings do not cause perpetual format failures (Task 1).
5. Markdown examples and YAML expressions remain valid (Task 1).

### Task 1: Formatter and mechanical pass

**Files:** package.json, pnpm-lock.yaml, `.prettierignore`, `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, maintained source/config/docs, docs/development.md.
**Interfaces:** Produces `pnpm format` and `pnpm format:check`; no runtime interface changes.

- [x] After PR 1 is integrated, create fresh branch. Verify current stable Prettier in the registry and install exact devDependency.
- [x] Add scripts `format: prettier --write .` and `format:check: prettier --check .`. Use defaults plus `.prettierrc.json` containing `{"endOfLine":"lf"}` for cross-platform consistency.
- [x] Ignore node_modules, dist, coverage, .superpowers, .causign, .agentest, pnpm-lock.yaml and packages/protocol/src/generated.ts. Ensure formatter respects hidden scratch exclusions.
- [x] Run check before writing and record its unformatted-file result; run format; rerun check successfully. Do not alter expressions or introduce cleanup fixes.
- [x] Add format:check after install in both acceptance/publication workflows and document commands.
- [x] Inspect `git diff --ignore-all-space`; explain syntactic formatter-only changes and check generated source/lockfile exclusions. Lockfile may change only for the pinned formatter dependency.
- [x] Run complete verification. Commit `style: format maintained source and enforce consistency`; create PR 2 with whitespace-insensitive review guidance.
