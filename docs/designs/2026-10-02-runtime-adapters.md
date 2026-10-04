# Causign runtime adapters

Status: approved design, implemented on `codex/extensible-agent-discovery`.
Claude output profile and open plugins are fixture-verified. Codex discovery is
implemented; production output execution remains unavailable until global tool
denial is verified, as required by the profile's enforcement gate below.

## Objective

Let developers discover and test agents from any framework through an open
registry of discovery plugins and execution adapters. Claude Code, Codex, Gemini,
Copilot, OpenCode and Pi are examples, not a closed list or a central enum.
Framework, runtime, model, inference provider and transport are separate concepts.
Reuse `causign/1` and the current
scenario/result contracts instead of introducing a protocol per vendor.

The first release implements the extensible registry and Claude Code/Codex
reference plugins. An external plugin must support an additional framework
without modifying Causign core or CLI. Other integrations are examples of future
extensions and must not be advertised as runnable adapters.
The user confirmed Pi means pi-coding-agent. Copilot includes both its CLI and
the integrated VS Code agent: six product families, seven execution targets.
No automatic installation or provider login.

## Architecture and alternatives

Preferred: a `@causign/runtime` package for the versioned plugin API, registry,
bounded discovery/probing and process execution primitives, plus `@causign/adapter-claude-code` and
`@causign/adapter-codex` for native translation. Each adapter is a protocol
process usable through the existing config's command/args/cwd fields.

A framework-specific harness per runtime duplicates process management and
evidence policy. A generic Markdown-to-system-prompt executor loses native agent
resolution, permissions and tool semantics. Native adapters with a common
contract preserve those distinctions. Existing Vercel integration stays separate.

Discovery and execution are independent extension points. A discoverer may read
several definition formats; several adapters may support the same candidate.
A custom framework can implement either or both. Existing protocol-speaking
agents remain usable directly without a discovery plugin.

```text
Explicit sources (directories, files, configured services)
                         |
                Registered discoverers
                         |
              Candidates + diagnostics
                         |
             Explicit adapter selection
                         |
            Probe + capability validation
                         |
               causign/1 execution
```

## Plugin registration

Plugin API version `1` is separate from wire protocol `causign/1`. A plugin exports
a descriptor with an ID, API version, discoverers and execution adapters. IDs are
namespaced strings, not vendor enums. Duplicate IDs and unsupported API versions
are registry errors; loading is transactional and cannot leave a partial registry.
Built-in reference plugins use the same public registration API as third parties.

CLI extensions are explicitly loaded through `--plugins <manifest.json>`. The
manifest contains `schemaVersion: "1"` and a `plugins` array of installed module
specifiers or local module paths resolved relative to the manifest. No automatic
package installation, registry search or loading code from discovered definitions.
Registered plugin modules are trusted executable code; scanned definitions are
untrusted data. The existing strict execution config schema stays unchanged.
The programmatic API also accepts plugin objects through dependency injection.

## Shared contracts

`RuntimeDescriptor`: stable runtime ID, display name, adapter implementation
status, supported execution modes and known tested version constraints.

`AgentCandidate`: discoverer ID, stable candidate ID, optional framework/runtime IDs,
native selector where defined, display name,
description, source kind/path, definition content hash and diagnostics. Optional
model/provider metadata comes only from explicit configuration/definition.
Candidate identity includes discoverer, canonical source and native definition ID;
display names are not unique. Candidate IDs stay stable across content changes;
the separate hash identifies the inspected revision. Instructions are untrusted
definition data, never instructions to discovery. Discovery does not evaluate
scanned user JS or run a model. Explicit registered plugin loading executes code.

`RuntimeProbe`: executable availability, runtime version, selected execution mode,
compatibility diagnostics and capabilities supported by that tested mode.
Authentication is not established merely by finding an executable. Probes must
not print tokens, read authentication secrets or initiate login.

`RuntimeLaunch`: executable, argument array, cwd, bounded transport settings and
native/WSL execution target; selected candidate, optional explicit model/provider
and mode-specific settings. Arbitrary free-form shell commands are not accepted.

Discoverer interface: `discover(source, limits)` returns candidates and diagnostics.
Execution adapter interface: `supports(candidate)`, `probe(target, selection)` and
`createLaunch(selection)`. Matching is declarative and side-effect free; a match
alone proves neither executable availability nor capabilities. Multiple matching
adapters are reported and require explicit selection, never first-match wins.
The adapter executable implements the existing handshake/configure/run lifecycle.
Interface names above describe the proposed API, not shipped public exports.

## Discovery

Proposed command: `causign discover --path <root> [--discoverer <id>]
[--plugins <manifest.json>] [--json]`. Without a discoverer filter, run all
registered file discoverers applicable to the explicit source. Service sources
use `--source <configured-source-id>` and require an explicitly configured plugin;
do not crawl arbitrary remote endpoints. The initial reference plugins use files.
It reads an explicitly chosen definition source, returns candidates and diagnostic
records, and does not mutate config or start a live session. Scanning is bounded
by file count, per-file bytes, total bytes and elapsed time. Exclude dependency,
build, VCS and result directories; do not scan home directories implicitly.
Plugins receive cancellation and limits and must honor them. In-process plugins
are trusted, so these limits are cooperative rather than a security sandbox.
Results never become
execution targets automatically. A missing/unsupported source is explicit rather
than an empty successful scan. Do not follow symlinks. Unknown formats are
reported as unrecognized sources, not invented agents. A generic Markdown
discoverer can report instruction candidates with execution unresolved.

Discovery reports recognition and possible adapter matches. Probe reports
availability separately. Scenario preparation reports compatibility separately:
**found != executable != compatible with this scenario**. Discovery does not
claim authentication, tool control or successful execution.

Claude: parse Markdown YAML frontmatter in the selected `.claude/agents` source,
preserving native selectors and reporting malformed definitions, duplicate names,
unknown metadata and runtime-invalid names. Resolve documented native precedence
when several scopes are explicitly supplied. Do not silently rewrite originals.

Codex: discover explicitly selected configuration profiles and supported native
agent definitions where the pinned runtime supports them. `AGENTS.md` is context,
not an independently executable agent. Candidate source kind distinguishes
profiles, native agent definitions and instructions. No inferred executable
agents for arbitrary Markdown. Final supported parsers require source/version
verification before implementation.

WSL paths require an explicit distro and POSIX execution root. A Windows UNC
source is not passed directly as a Linux cwd. Use `wsl.exe` with literal argument
arrays and the selected distro; never construct a shell from definition text.

## Initial execution profiles

**Output profile:** final structured text output and runner latency, with actual
runtime result/error provenance. Provider/tool observation is unsupported unless
the selected translator has verified lifecycle evidence. No model call is made
before capability negotiation. Output-only scenarios requiring mocks, approval
control or tool observation are INCOMPATIBLE before native session launch.

Default native tool policy is deny/disable, not an approval bypass. Runtimes may
reject a particular requested profile if their interface cannot enforce it.
No dangerously-skip flags. Native user hooks/settings can cause side effects;
effective configuration must be controlled or their inheritance disclosed.
Discovery and process isolation are not security sandboxes.

Claude Code: native agent selection and print structured output. Installed version
observed: 2.1.284. Translation must check result success/error fields and process
exit status; an intermediate assistant text is not a successful final result.

Codex CLI: explicit prompt/profile, `exec --json`, fresh ephemeral session where
supported, read-only sandbox and structured final response extraction. Installed
version observed: 0.159.0. Respect native auth and explicit model settings. Do not
reinterpret AGENTS.md as an independent subagent.

The output contract is `{text: string}` for both adapters. Missing/ambiguous final
output, malformed frames or a disconnect are ERROR. Tool-disabled runs can still
fail natively; they must not fabricate a successful business result.

**Controlled-tools profile (later gate):** investigate Claude hooks/Agent SDK and
Codex app-server as bidirectional hosts. Native streams alone are not interception.
Map requests, starts, completions, failures and rejection provenance separately.
Do not infer real execution from a request or post-hoc text. Mock support requires
a verified result-substitution API. A pre-tool hook is not proof of actual start.
Advertise each capability only after conformance tests establish its semantics.

Critical gate: if a native hook timeout can permit an operation, it cannot provide
Causign `intercept.tools` without a stronger verified authorization boundary.
On transport loss/cancellation no pending decision is permitted to authorize
effects. Unknown/new native event shapes invalidate relevant evidence; do not
silently drop them and assert trace completeness.

## Reference integrations and extension examples

This table documents delivery scope; it is not a registry whitelist. External
frameworks, custom processes, SDK applications and future runtimes register
plugins without adding rows here or changing core. Non-process API/editor hosts
can use a protocol-speaking bridge launched through the existing AgentReference;
the first delivery does not implement those bridges.

| Runtime                      | First delivery                       | Subsequent validation surface                                  |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Claude Code                  | Discovery + output adapter           | Hooks/Agent SDK control semantics                              |
| Codex CLI                    | Versioned discovery + output adapter | app-server requests and approvals                              |
| Gemini CLI                   | Extension example                    | Headless stream + control integration                          |
| GitHub Copilot CLI           | Extension example                    | Supported programmatic/event interfaces                        |
| GitHub Copilot VS Code agent | Extension example                    | Documented extension/host integration and event/control access |
| OpenCode                     | Extension example                    | CLI/server events, agent and provider selection                |
| Pi (pi-coding-agent)         | Extension example                    | Verify versioned RPC/events                                    |

Copilot CLI and VS Code use distinct runtime IDs (`copilot-cli`,
`copilot-vscode`) under the same family. VS Code is an editor-host target, not a
CLI launch alias. Investigate a supported extension/host bridge before claiming
execution or telemetry access. Do not automate the GUI or create a chat participant
and call that control of the built-in Copilot agent. User-provided Markdown agent
discovery alone does not establish executable control. If the public host APIs
cannot expose the required built-in-agent lifecycle, keep execution explicitly
unsupported and document the constraint; do not silently substitute the CLI.

Catalogue inclusion means scope, not tested compatibility. Exact upstream versions
and fixtures are recorded per adapter. Model/provider choice is optional explicit
configuration, not a new adapter for every model.

## Evidence, compatibility and cleanup

Record adapter/runtime version, candidate hash, execution mode and explicit
model/provider in existing metadata where appropriate. Do not publish credentials
or whole runtime configuration. Runtime IDs and native IDs remain distinguishable.
Missing runtime/candidate is an actionable preflight error; unsupported scenario
capabilities remain INCOMPATIBLE. No cost inference from token usage.

Bound both native and protocol streams, propagate cancellation, close subprocesses
and document WSL descendant-cleanup limits. No background model session may be
left intentionally running after a finished scenario. Fresh session per scenario;
no implicit resume, global settings mutation or original-definition modification.

## Acceptance criteria

1. Discover the user's explicitly selected Claude agent directory without model
   execution; valid and invalid definitions produce usable diagnostics.
2. Probe Claude/Codex versions and generate reviewable launches with literal args.
3. Run identical deterministic output scenarios against simulated native CLIs;
   validate PASS, FAIL, ERROR and pre-launch INCOMPATIBLE.
4. Prove mock/tool assertions cannot pass against output-only profiles.
5. Test invalid JSONL, native failures, timeouts, cancellation and bounded capture.
6. Preserve the existing Vercel adapter and suite, with clean packed consumers.
7. CI fixtures need no credentials. Live provider runs are separate opt-in checks
   with user-selected agent/model, finite bounds and reported quota usage.
8. Update documentation with a capability matrix and pending statuses, plus
   honest Windows/native/WSL support limits for these new integrations.
9. An external fixture plugin discovers and runs an invented framework using
   the public registry API, without editing core, CLI or a vendor enum.
10. Verify duplicate registration, unsupported plugin API, multiple adapter
    matches, unknown formats and generic instruction candidates. None may
    silently become executable agents or claim unsupported capabilities.
11. Verify scan limits, cancellation, excluded directories, stable identity and
    changed-content hashes. Discovery does not invoke model processes.

## Rollout

Review this design, then write an implementation plan and select its execution
method. Build shared contracts/discovery first, then Claude and Codex output
adapters, then cross-runtime conformance and documentation. Tool-control support
is a separately gated extension, not a claim shipped by output adapters.
No npm publication or release version change occurs automatically during this
design/implementation work.

## Primary references

- [Claude subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude CLI](https://code.claude.com/docs/en/cli-reference)
- [Claude hooks](https://code.claude.com/docs/en/hooks)
- Codex installed CLI help (`exec`, `app-server`); installed sources/schema are
  authoritative for the targeted version.
- [Codex app-server](https://developers.openai.com/codex/app-server/)
- [Gemini headless](https://geminicli.com/docs/cli/headless/)
- [Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli)
- [OpenCode CLI](https://opencode.ai/docs/cli/)

Reference discovery identifies possible integration surfaces, not verified
capabilities. Local runtime fixtures/conformance are required before claims.
