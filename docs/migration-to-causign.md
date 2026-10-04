# Migrating to Causign

The MVP has been renamed from Agentest to Causign. This is a coordinated breaking
rename, not an alias layer. Migrate runner and adapters together.

| Previous name                                               | Current name                                             |
| ----------------------------------------------------------- | -------------------------------------------------------- |
| `@agentest/*` packages                                      | `@causign/*`                                             |
| `agentest` executable                                       | `causign`                                                |
| `agentest.config.ts`                                        | `causign.config.ts`                                      |
| `*.agentest.ts` scenario discovery                          | `*.causign.ts`                                           |
| `.agentest/results` default artifacts                       | `.causign/results`                                       |
| `agentest/1` wire protocol                                  | `causign/1`                                              |
| `https://agentest.dev/schemas/` schema IDs                  | `https://causign.dev/schemas/`                           |
| `AgentestConfig` type                                       | `CausignConfig`                                          |
| `AGENTEST_PYTHON`, `AGENTEST_PNPM`, `AGENTEST_PACKED_STORE` | `CAUSIGN_PYTHON`, `CAUSIGN_PNPM`, `CAUSIGN_PACKED_STORE` |
| `$agentest` assistant skill                                 | `$causign`                                               |

Update package imports and dependencies, lockfile, scenario/config filenames,
scripts, CI artifact paths and custom adapters. Adapters must advertise and emit
`causign/1`; frames using the old protocol are not accepted by the renamed runner.
Schema URLs identify contracts; they do not require a network schema service.

Scenario/result `schemaVersion: '1'` and the `agentTest()` / `expect` SDK API keep
their existing behavior. Rebuild before packing, then rerun negotiation and
acceptance with the renamed runner. Earlier artifacts remain historical records;
they are not automatically rewritten or imported. The previous artifact directory
stays ignored by Git to preserve local history without committing run data.

The GitHub repository is now `sebamar88/Causign`. The code rename does not publish
npm packages, reserve a domain or establish ownership of the `@causign` registry scope.
