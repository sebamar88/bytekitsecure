# Getting started

## Run with npx, pnpm dlx or pnpx

In a new directory, no project installation is needed for the starter:

```sh
npx --yes @causign/cli@0.1.0 init
npx --yes @causign/cli@0.1.0 inspect
npx --yes @causign/cli@0.1.0 run
```

Equivalent pnpm commands:

```sh
pnpm dlx @causign/cli@0.1.0 init
pnpm dlx @causign/cli@0.1.0 inspect
pnpm dlx @causign/cli@0.1.0 run
```

Or use `pnpx @causign/cli@0.1.0 init`, replacing `init`
with `inspect` or `run` as needed. Pinning the version makes the intended CLI
release explicit. Downloads are cached by the executor; these commands do not
add the CLI to project dependencies. pnpm may update its release-age exceptions
according to the current project's trust policy.

The static starter does not import the SDK. For your own scenarios importing
`@causign/sdk`, install it locally; the executor's CLI cache is not a substitute
for application dependencies. Use a lockfile/project installation for repeatable CI.

See [npm executor documentation](https://docs.npmjs.com/cli/v11/commands/npm-exec/)
and [pnpm temporary execution](https://pnpm.io/cli/dlx) for executor behavior.

## Install from npm

Use Node 22+ and a new project directory:

```sh
pnpm init
pnpm add -D @causign/cli@0.1.0 @causign/sdk@0.1.0
pnpm exec causign init
pnpm exec causign inspect
pnpm exec causign run
```

Expected: PASS sample-greeting, exit 0, with plan/trace/results under
`.causign/results`. This exact flow was verified by a Windows consumer using
Node 24.21.0 and pnpm 12.8.1. Inspect reports compatibility as unverified until
run negotiates with the adapter.

If install or exec stops with `ERR_PNPM_IGNORED_BUILDS` naming esbuild,
explicitly reject its build in the project's `pnpm-workspace.yaml` (merge rather
than replace existing settings):

```yaml
allowBuilds:
  esbuild: false
```

Run `pnpm install` and resume at `causign init`. This was verified on Windows
with pnpm 12.8.1, a fresh package store and the published 0.1.0 packages.
The CLI uses tsx, which uses esbuild; the platform binary arrives as an optional
dependency, so postinstall is unnecessary in this verified setup. Do not omit
optional dependencies. Temporary dlx/pnpx environments have their own build
approval state; project settings are not guaranteed to control that cache.
`--allow-build=esbuild` is an optional explicit approval for those environments,
not a Causign requirement.
If init was blocked, run cannot find config until starter creation succeeds.
Repeated init refuses existing targets by design.

## Build from source

Use Node 22+ and pnpm 11.25.0. Python 3 is needed for repository acceptance,
not every CLI invocation.

```sh
git clone https://github.com/sebamar88/Causign.git causign
cd causign
pnpm install --frozen-lockfile
pnpm build
```

From the repository root, create a demo directory. These commands work in
PowerShell and POSIX shells without replacing any paths:

```sh
node -e "require('node:fs').mkdirSync('.causign/quickstart', { recursive: true })"
cd .causign/quickstart
node ../../packages/cli/dist/bin.js init
node ../../packages/cli/dist/bin.js inspect
node ../../packages/cli/dist/bin.js run --verbose
```

The relative CLI path above assumes the current directory is `.causign/quickstart`
inside this checkout. For a separate existing project, invoke the CLI with the
actual absolute checkout path; in PowerShell quote paths containing spaces.
Rerunning `init` in the same demo refuses existing files; reuse `inspect` and
`run` instead. `init` creates
`causign.config.ts`, `sample.causign.ts` and `sample-agent.mjs`. Existing
target files, directories or symlinks cause refusal before writing.
The starter agent returns a greeting without a provider.

## Configure an instrumented agent

```ts
export default {
  schemaVersion: "1",
  agents: {
    support: {
      command: process.execPath,
      args: ["support-agent.mjs"],
      cwd: ".",
    },
  },
  evaluators: {},
};
```

The command must speak Causign JSONL. Arguments are passed directly without a
shell. Agent working directories resolve from the config directory, including
omitted cwd. `env` supplies extra process environment values; do not commit secrets.

## Commands and discovery

| Command           | Purpose                                                |
| ----------------- | ------------------------------------------------------ |
| `causign init`    | Generate starter files in the current directory        |
| `causign inspect` | Validate/normalize definitions without starting agents |
| `causign run`     | Negotiate, execute and evaluate                        |

`inspect` and `run` accept positional file/glob filters and `--config path`.
Run also accepts `--output-dir path` and `--verbose`.

```sh
pnpm exec causign inspect 'tests/**/*.causign.ts' --config causign.config.ts
pnpm exec causign run 'tests/**/*.causign.ts' --output-dir .causign/results --verbose
```

Discovery searches recursively from config for `**/*.causign.ts`. Dependencies,
build output, coverage, Git and Causign artifacts are excluded; symlinks are
not followed. No matches, empty collections and duplicate IDs produce ERROR.
Config and scenario imports execute local code; inspect is not a sandbox.

## Local package installation

For unpublished local changes, build, then run
`pnpm pack --pack-destination /absolute/path/to/archives` from each of the five
package directories: protocol, core, sdk, cli and adapter-vercel.
Copy the archives to your consumer root and merge these settings into its
`pnpm-workspace.yaml`:

```yaml
overrides:
  "@causign/protocol": file:./causign-protocol-0.1.0.tgz
  "@causign/core": file:./causign-core-0.1.0.tgz
  "@causign/sdk": file:./causign-sdk-0.1.0.tgz
  "@causign/cli": file:./causign-cli-0.1.0.tgz
  "@causign/adapter-vercel": file:./causign-adapter-vercel-0.1.0.tgz
```

```sh
pnpm add -D ./causign-protocol-0.1.0.tgz ./causign-core-0.1.0.tgz ./causign-sdk-0.1.0.tgz ./causign-cli-0.1.0.tgz ./causign-adapter-vercel-0.1.0.tgz ai@7.0.127
pnpm exec causign init
pnpm exec causign inspect
pnpm exec causign run
```

This full-distribution recipe includes Vercel and its exact peer. Custom agents
do not require Vercel. The [packed smoke script](../scripts/packed-smoke.mjs)
is the executable reference, including pnpm build policy and release-age
exceptions for the exact dependencies. Installation does not publish packages.

Continue with [scenarios](scenarios.md), [adapters](adapters.md) or
[results](results-and-security.md).
