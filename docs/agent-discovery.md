# Discover and connect agents

Discovery answers **what definitions are present**. An execution adapter answers
**how to run one**. Scenario negotiation answers **what can be tested**. These are
separate checks: finding an agent does not prove that it is executable,
authenticated or compatible with a security assertion.

This feature is implemented on the development branch. It is **not included in
the published CLI 0.1.0**. Until a new release, build the repository and invoke its
CLI with an absolute path:

```sh
pnpm install --frozen-lockfile
pnpm build
node /absolute/path/to/Causign/packages/cli/dist/bin.js discover --path ./agents --json
```

On Windows, quote the absolute CLI path when it contains spaces. For your WSL
Claude directory, discovery from Windows accepts the explicit UNC source:

```powershell
node .\packages\cli\dist\bin.js discover --path '\\wsl.localhost\Ubuntu-26.04\home\sebamar88\.claude\agents' --discoverer causign/claude-agents --json
```

Execution is configured separately with `{kind:'wsl', distro:'Ubuntu-26.04',
cwd:'/home/sebamar88/project', command:'/home/sebamar88/.local/bin/claude'}`.
A UNC source is never passed as a Linux working directory.

## Built-in recognition

| Discoverer                      | Recognizes                                                                               | Execution                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `causign/markdown-instructions` | Markdown instruction files                                                               | Unresolved; context is not an executable agent   |
| `causign/claude-agents`         | Claude-compatible YAML frontmatter with native name/description and Markdown body        | Claude output profile, reference version 2.1.284 |
| `causign/codex-config`          | Explicit `<name>.config.toml` profile files matching the observed 0.159.0 profile format | Blocked until global tool denial is verified     |

Without a filter, all registered file discoverers inspect the chosen source.
The same Markdown may appear as an instruction candidate and a Claude-format
candidate: those are distinct interpretations with distinct IDs. Names alone
are not evidence of runtime ownership. Use `--discoverer` to select a format.
Duplicate native selectors produce diagnostics; do not execute from an incomplete
report. Legacy embedded Codex profiles are reported as unsupported.

## Open plugins

Frameworks and providers are not a hardcoded list. Register an installed package
or a local JavaScript module with a default `RuntimePlugin` export:

```json
{
  "schemaVersion": "1",
  "plugins": ["@your-team/causign-plugin", "./custom-plugin.mjs"]
}
```

```sh
node /absolute/path/to/Causign/packages/cli/dist/bin.js discover --path ./agents --plugins ./plugins.json --json
```

Module resolution uses the manifest directory, including ESM import exports.
Modules execute trusted local code. Discovery does not install missing packages
or import code found inside agent definitions. No global/home scan is implicit.

Plugin API `1` is distinct from wire protocol `causign/1`. A plugin provides:

```js
export default {
  id: "my-team/framework",
  apiVersion: "1",
  discoverers: [
    {
      id: "my-team/definitions",
      sourceKinds: ["file"],
      async discover(source, context) {
        // context.files supplies bounded {path,text,revision} entries.
        // Return {candidates,diagnostics,complete}; definitions remain data.
      },
    },
  ],
  adapters: [
    {
      id: "my-team/output",
      supports(candidate) {
        /* Side-effect-free format match. */
      },
      async probe(target, selection) {
        /* Availability, version, capabilities. */
      },
      async createLaunch(selection) {
        /* Existing {command,args,cwd,metadata} contract. */
      },
    },
  ],
};
```

See the complete executable [external framework fixture](../fixtures/runtime-plugins/custom-framework.mjs)
and [public TypeScript contracts](../packages/runtime/src/types.ts). Register IDs
with a namespace. Duplicate IDs or incompatible APIs fail registration. Multiple
adapter matches are listed; Causign never chooses the first silently.

Configured services use optional manifest `sources` entries containing
`discovererId` and plugin-specific `options`, then `discover --source <id>`.
Use credential references rather than inline secrets. Reference plugins only read
files; HTTP/API discovery requires an explicitly registered service discoverer.

## Select and prepare execution

The first delivery offers programmatic launch preparation; discovery does not
write your test config or run a model. With the development packages installed:

```js
import { writeFile } from "node:fs/promises";
import { createRegistry, discoverAgents } from "@causign/runtime";
import claude from "@causign/adapter-claude-code";

const registry = createRegistry([claude]);
const report = await discoverAgents(registry, {
  kind: "file",
  path: "/absolute/agents",
});
if (!report.complete) throw new Error("Resolve discovery diagnostics first");
const candidate = report.candidates.find((item) => item.id === process.argv[2]);
if (!candidate) throw new Error("Choose an explicit candidate ID");
const adapter = registry.adapters.find(
  (item) => item.id === "causign/claude-output",
);
const selection = {
  candidate,
  adapterId: adapter.id,
  mode: "output",
  target: { kind: "native", command: "claude", cwd: process.cwd() },
};
const probe = await adapter.probe(selection.target, selection);
if (!probe.capabilities.includes("observe.output"))
  throw new Error(JSON.stringify(probe.diagnostics));
const launch = await adapter.createLaunch(selection);
await writeFile("selected-agent.json", JSON.stringify(launch, null, 2), {
  flag: "wx",
});
```

Review the generated command/args/metadata. Copy that AgentReference into your
existing `causign.config.ts` agents map. The definition hash is checked again at
launch; edited definitions require rediscovery. Targets accept optional literal
prefix `args` for executable wrappers, without shell interpolation.

Claude native output is `{text:string}`. Assert `output.equal` with that shape,
or use the existing output assertions. Scenarios requiring mocks, tool observation
or approval control return INCOMPATIBLE before native model execution. Output
tests do not certify native tool-security behavior.

## Limits and native behavior

Default scan bounds: 10,000 files, 1 MiB/file, 32 MiB total and 10 seconds.
Dependency/build/VCS/result directories and symlinks are excluded. The
programmatic API can supply positive integer limits. Exceeding a bound returns
an incomplete report; CLI exits 2. Interrupted CLI exits 130.

Plugin limits are cooperative because plugins run in-process as trusted code.
Native output capture is bounded to 8 MiB; protocol frames to 1 MiB. Cancellation
terminates native processes; POSIX process groups and Windows taskkill tree
cleanup cover attached children, but detached descendants and WSL host/Linux
boundaries cannot be guaranteed by these mechanisms. This is not a sandbox.

Claude disables built-in tools, MCP configuration, skills, ordinary settings and
ordinary hooks for the output profile. Native authentication/provider environment
and managed policy still apply. Managed hooks cannot be disabled by ordinary
CLI settings; review managed configuration before a live run. These native
options and limits are documented in the [Claude CLI](https://code.claude.com/docs/en/cli-reference)
and [hook reference](https://code.claude.com/docs/en/hooks).
Definitions requiring hooks, skills, MCP servers or initial prompts are rejected
by this restricted reference profile rather than silently executed differently.

Gemini, Copilot CLI, Copilot's VS Code agent, Pi and OpenCode can integrate through
the same extension points. They are not shipped adapters here. VS Code requires
a supported editor-host bridge, distinct from Copilot CLI; API/editor bridges and
controlled-tool profiles remain future implementations. Existing direct protocol
agents and the Vercel adapter continue to work.

CI uses deterministic native fixtures and external plugins without credentials.
Live provider runs remain opt-in and may consume your provider quota.
