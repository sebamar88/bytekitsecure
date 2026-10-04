import assert from "node:assert/strict";
import { runReportAcceptance } from "./report-acceptance.mjs";
import {
  mkdtemp,
  writeFile,
  readdir,
  cp,
  readFile,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute, sep } from "node:path";
import {
  command,
  root,
  runBuiltAcceptanceSuite,
} from "./release-acceptance.mjs";
const pnpm = process.env.CAUSIGN_PNPM ?? "pnpm";
async function pm(args, cwd) {
  // Windows command shims execute in one PowerShell with literal arguments.
  const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
  const result =
    process.platform === "win32"
      ? await command(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `& ${literal(pnpm)} ${args.map(literal).join(" ")}; exit $LASTEXITCODE`,
          ],
          cwd,
        )
      : await command(pnpm, args, cwd);
  assert.equal(result.exitCode, 0, result.stdout + "\n" + result.stderr);
  return result;
}
const consumer = await mkdtemp(join(tmpdir(), "causign packed consumer "));
const packageNames = [
  "protocol",
  "core",
  "sdk",
  "cli",
  "adapter-vercel",
  "runtime",
  "adapter-claude-code",
  "adapter-codex",
];
for (const name of packageNames)
  await pm(
    ["pack", "--pack-destination", consumer],
    join(root, "packages", name),
  );
const archives = (await readdir(consumer)).filter((f) => f.endsWith(".tgz"));
assert.equal(archives.length, packageNames.length);
const packed = {};
for (const name of packageNames) {
  const manifest = JSON.parse(
    await readFile(join(root, "packages", name, "package.json"), "utf8"),
  );
  const archive = `${manifest.name.replace("@", "").replace("/", "-")}-${manifest.version}.tgz`;
  assert(archives.includes(archive), `Missing packed archive: ${archive}`);
  packed[manifest.name] = `file:./${archive}`;
}
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      type: "module",
      dependencies: { ...packed, ai: "7.0.127" },
    },
    null,
    2,
  ),
);
await writeFile(
  join(consumer, "pnpm-workspace.yaml"),
  "allowBuilds:\n  esbuild: false\nminimumReleaseAgeExclude:\n  - ai@7.0.127\n  - '@ai-sdk/gateway@4.0.103'\noverrides:\n" +
    Object.entries(packed)
      .map(([name, path]) => `  '${name}': '${path}'\n`)
      .join(""),
);
// A frozen workspace install does not populate registry metadata for a new
// consumer. Resolve its own lockfile and fetch packages before testing offline.
const storeArgs = process.env.CAUSIGN_PACKED_STORE
  ? ["--store-dir", process.env.CAUSIGN_PACKED_STORE]
  : [];
await pm(["install", "--lockfile-only", ...storeArgs], consumer);
await pm(["fetch", ...storeArgs], consumer);
await pm(["install", "--offline", "--frozen-lockfile", ...storeArgs], consumer);
const canonicalConsumer = await realpath(consumer);
for (const name of packageNames) {
  const installed = await realpath(
    join(consumer, "node_modules/@causign", name),
  );
  const withinConsumer = relative(canonicalConsumer, installed);
  assert(
    withinConsumer !== ".." &&
      !withinConsumer.startsWith(`..${sep}`) &&
      !isAbsolute(withinConsumer),
    "Installed package resolves inside clean consumer",
  );
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert(
    !JSON.stringify(manifest.dependencies ?? {}).includes("workspace:"),
    "Pack replaces workspace references",
  );
}
await cp(join(root, "examples"), join(consumer, "examples"), {
  recursive: true,
});
await cp(join(root, "fixtures"), join(consumer, "fixtures"), {
  recursive: true,
});
for (const folder of ["support", "coding", "devops", "rag", "coordinator"])
  for (const file of ["agent.mjs", "scenario.mjs", "evaluator.mjs"]) {
    const path = join(consumer, "examples", folder, file);
    try {
      const source = (await readFile(path, "utf8")).replaceAll(
        "../../packages/sdk/dist/index.js",
        "@causign/sdk",
      );
      assert(
        !source.includes("../../packages/"),
        "Consumer uses installed packages",
      );
      await writeFile(
        path,
        source.replaceAll("../../packages/sdk/dist/index.js", "@causign/sdk"),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
await runBuiltAcceptanceSuite({
  base: consumer,
  bin: join(consumer, "node_modules/@causign/cli/dist/bin.js"),
});
await writeFile(
  join(consumer, "example-agent.json"),
  JSON.stringify({
    framework: "example",
    name: "External Agent",
    text: "hello",
  }),
);
await writeFile(
  join(consumer, "plugins.json"),
  JSON.stringify({
    schemaVersion: "1",
    plugins: ["./fixtures/runtime-plugins/custom-framework.mjs"],
  }),
);
const discovery = await command(
  process.execPath,
  [
    join(consumer, "node_modules/@causign/cli/dist/bin.js"),
    "discover",
    "--path",
    consumer,
    "--plugins",
    join(consumer, "plugins.json"),
    "--discoverer",
    "example/json-agents",
    "--json",
  ],
  consumer,
);
assert.equal(discovery.exitCode, 0, discovery.stderr);
assert.equal(JSON.parse(discovery.stdout).candidates[0].name, "External Agent");
await writeFile(
  join(consumer, "plugin-smoke.mjs"),
  `
import assert from 'node:assert/strict';
import {createRegistry,loadPluginManifest,discoverAgents} from '@causign/runtime';
import {runScenario} from '@causign/core';
const registry=createRegistry(await loadPluginManifest('./plugins.json'));
const report=await discoverAgents(registry,{kind:'file',path:process.cwd()});
const adapter=registry.adapters.find(adapter=>adapter.id==='example/output');
const launch=await adapter.createLaunch({candidate:report.candidates[0],adapterId:adapter.id,mode:'output',target:{kind:'native',cwd:process.cwd()}});
const result=await runScenario({schemaVersion:'1',id:'packed-plugin',name:'packed-plugin',agent:'a',input:null,mocks:[],assertions:[{id:'text',type:'output.equal',parameters:{value:{text:'hello'}},negated:false,requirements:[]}],requirements:[],timeoutMs:3000},{schemaVersion:'1',agents:{a:launch},evaluators:{}});
assert.equal(result.status,'PASS',JSON.stringify(result));
`,
);
const pluginSmoke = await command(
  process.execPath,
  [join(consumer, "plugin-smoke.mjs")],
  consumer,
);
assert.equal(pluginSmoke.exitCode, 0, pluginSmoke.stderr);
await runReportAcceptance({
  bin: join(consumer, "node_modules/@causign/cli/dist/bin.js"),
  cwd: consumer,
});
console.log(
  `Packed acceptance passed: ${packageNames.length} archives installed offline, seven baseline scenarios + external plugin + local report viewer, consumer ${consumer}`,
);
