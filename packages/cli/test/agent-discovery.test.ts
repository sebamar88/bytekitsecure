import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "causign-cli-agents-"));
  roots.push(root);
  return root;
}
async function invoke(cwd: string, args: string[]) {
  const stdout: string[] = [],
    stderr: string[] = [];
  const exitCode = await main(args, {
    cwd,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  });
  return { exitCode, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
it("discovers agents without needing scenario configuration", async () => {
  const root = await setup();
  await writeFile(join(root, "AGENTS.md"), "# instruction");
  const result = await invoke(root, ["discover", "--path", ".", "--json"]);
  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.candidates[0]).toMatchObject({
    kind: "instructions",
    adapterIds: [],
  });
});
it("loads an explicitly registered service discoverer", async () => {
  const root = await setup();
  await writeFile(
    join(root, "service.mjs"),
    `export default {id:'test/service',apiVersion:'1',adapters:[],discoverers:[{id:'test/source',sourceKinds:['service'],async discover(source){return {complete:true,diagnostics:[],candidates:[{id:'remote-1',discovererId:'test/source',kind:'agent',name:source.options.name,source:{kind:'service',id:source.id},revision:'v1'}]};}}]};`,
  );
  await writeFile(
    join(root, "plugins.json"),
    JSON.stringify({
      schemaVersion: "1",
      plugins: ["./service.mjs"],
      sources: {
        remote: {
          discovererId: "test/source",
          options: { name: "Remote Agent" },
        },
      },
    }),
  );
  const result = await invoke(root, [
    "discover",
    "--plugins",
    "plugins.json",
    "--source",
    "remote",
    "--json",
  ]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout).candidates[0].name).toBe("Remote Agent");
});
it("requires explicit sources and rejects conflicting sources and unknown flags", async () => {
  const root = await setup();
  for (const args of [
    [],
    ["--path", ".", "--source", "remote"],
    ["--path"],
    ["--path", ".", "--oops"],
  ])
    expect((await invoke(root, ["discover", ...args])).exitCode).toBe(2);
});
it("returns an error for incomplete discovery with machine-readable diagnostics", async () => {
  const result = await invoke(await setup(), [
    "discover",
    "--path",
    "missing",
    "--json",
  ]);
  expect(result.exitCode).toBe(2);
  expect(JSON.parse(result.stdout).complete).toBe(false);
});
