# Formatting validation

PR 2 starts from integrated main at 4bb1efd. Prettier 3.9.9 was verified in the registry and installed as an exact development dependency. Format-check reported 197 unformatted files before writing and passes after writing.

All 137 changed JavaScript/TypeScript files match formatting the original revision with the pinned formatter, except the external-plugin source-test import marker. That marker now matches the double-quoted fixture import emitted by Prettier. The unchanged marker reproduced a failing unresolved-import test; updating it restored the full suite. No production expressions or import order were manually changed.

Generated protocol source is unchanged. The lockfile importer adds only the formatter dependency. Format checks run after install in both workflows. LF attributes prevent Windows checkout from restoring CRLF to maintained formatter file types.

Validation on Windows: format-check, generated-contract check, TypeScript build and oxlint passed; 451 tests passed with one existing POSIX-only skip. Packed acceptance installed eight archives offline and passed baseline scenarios, external plugin discovery and the local report viewer. Remote matrix results remain pending.

## Decisions and costs

1. Keep the approved in-place workflow on a fresh feature branch. Cost: less filesystem isolation than a separate worktree.
2. Use formatter check before/after as the mechanical task's RED/GREEN gate, supplemented by diff comparison and existing tests. Cost: equivalence depends on those checks rather than new behavioral tests.
3. Add LF Git attributes for formatter text types to prevent recurring Windows format failures. Cost: checkout policy changes for these text types; generated source remains unchanged in this diff.
4. Update the test's import marker to match the pinned formatter's double quotes after reproducing its failure. Cost: the fixture substitution still depends on formatter quote style.

Independent review of 4bb1efd..230dd52 returned Ready to merge, with no Critical, Important or Minor findings and no declined-to-judge items. It independently confirmed 174 of 183 changed files match formatting the base and 136 of 137 code files have identical normalized TypeScript ASTs; the sole AST change is the accepted fixture import marker. Full suite and packed evidence were supplied by the executor, not rerun by the reviewer. A Windows checkout export with core.autocrlf=true also passed format-check. Nineteen existing JSON files retained identical parsed values. Remote CI remains pending; cost: cross-platform integration is not yet established. No versions were bumped and no packages were published.
