# Adapter confidence validation

Branch: codex/adapter-confidence. Scope: PR 1 of the approved quality-hardening specification; formatting, lint additions and discovery extraction remain separate.

## Delivered behavior

Codex discovery tests now pin malformed base/profile TOML, invalid selectors/metadata, duplicate policy, ignored files, partial candidates, exact diagnostics, IDs and revisions. Translator cases cover invalid records, missing/duplicate/out-of-order events, unknown items, unsuccessful native exits/signals and valid CRLF/updates.

One production defect was reproduced: two thread.started events before a turn were accepted as successful output. A failing regression now passes after adding a thread-start state flag. Native Codex execution remains unavailable where the tool-denial guarantee is unsupported.

Vercel tests cover unknown usage dimensions across steps, known zero, invalid inputs/limits/JSON output and pending cancellation. Actual serveAgent protocol tests now include tool rejection and assert that mocks/rejections never invoke the real callback or emit tool.started. New bridge waits react to stream events with a bounded failure timeout; they do not poll.

## Fresh measurements

| Measurement                 | Before                | After                 |
| --------------------------- | --------------------- | --------------------- |
| Full tests                  | 404 passed, 1 skipped | 451 passed, 1 skipped |
| Codex branches              | 71.18%                | 94.44%                |
| Vercel branches             | 93.05%                | 97.61%                |
| Codex statements/functions  | 100% / 100%           | 100% / 100%           |
| Vercel statements/functions | 100% / 100%           | 100% / 100%           |
| Repository statements/lines | 93.08%                | 93.08%                |
| Repository branches         | 85.16%                | 86.28%                |

Codex translator branch coverage is 100%. Remaining Codex branches include unavailable launch/probe paths and optional discovery metadata short-circuit combinations. Vercel retains uncovered optional usage/response-content branches. These are not excluded to raise coverage. There is no new arbitrary coverage threshold.

Generated-contract check, TypeScript build, repository oxlint, and complete V8 suite passed on Windows. One existing POSIX process-tree test is skipped on Windows. Clean-consumer acceptance installed eight packed archives and passed seven baseline scenarios, external plugin discovery and the report viewer. Remote CI results are not yet claimed.

## Implementation decisions

1. Use the existing checkout on a fresh feature branch, preserving the user's in-place workflow. Cost: less filesystem isolation than a separate worktree.
2. The baseline reporter did not emit coverage-final.json; use its fresh text table and explicitly request JSON for final coverage. Cost: baseline is summarized at adapter level rather than archived per-branch JSON.
3. Reject duplicate native thread starts as invalid sequencing after a RED reproduction; do not enable production Codex execution. Cost: previously tolerated malformed native traces are rejected.
4. Keep the existing approval fixture's polling outside the new evidence cases; new reject/mock bridge waits are event-driven. Cost: one legacy approval fixture still uses polling.

## Independent review and one fix pass

Review of 604cc29..6f38e0e returned **With fixes**: one Important gap, no Critical or Minor findings. The post-terminal test used an unsupported event, so it did not specifically protect the terminal guard. It now sends an otherwise valid item.updated after completion. Removing the guard produced exactly one failing test (RED); restoring it passes in the full suite (GREEN). No further production change was needed and no second review was requested.

Review limitations and rulings:

5. Formatting, stronger lint and shared discovery remain subsequent PRs. Cost: those quality concerns remain until their separate integration.
6. Live providers and enabling native Codex execution remain outside scope. Cost: deterministic fixtures do not establish live-provider compatibility.
7. Historical approval polling remains deferred under decision 4. Cost: that legacy fixture retains polling.
8. Remote CI and reviewer-independent full execution were not performed. Accept fresh local verification as evidence for opening the PR; require GitHub checks before integration. Cost: cross-platform CI is pending.
9. Include this durable validation report with the PR despite its absence from the reviewed commit snapshot. Cost: report closure is author-verified, not independently rereviewed.
10. Address the sole Important finding in one fix pass, demonstrated by guard mutation and the complete suite. Cost: no second independent review, as required by the execution workflow.

No package versions or publishing configuration changed. No minor findings were deferred.
