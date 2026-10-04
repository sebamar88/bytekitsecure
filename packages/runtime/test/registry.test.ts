import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, loadPluginManifest } from "../src/index.js";
import type { RuntimePlugin, AgentCandidate } from "../src/index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
const plugin = (id = "example/plugin"): RuntimePlugin => ({
  id,
  apiVersion: "1",
  discoverers: [],
  adapters: [],
});
const candidate = {
  id: "c",
  discovererId: "example/discoverer",
  name: "Agent",
  source: { kind: "file", path: "/agent" },
  revision: "abc",
  kind: "agent",
} as AgentCandidate;
describe("plugin registry", () => {
  it("rejects duplicate IDs across registrations", () => {
    expect(() => createRegistry([plugin(), plugin()])).toThrow(/duplicate/i);
  });
  it("rejects unsupported API versions", () => {
    expect(() =>
      createRegistry([
        { ...plugin(), apiVersion: "2" } as unknown as RuntimePlugin,
      ]),
    ).toThrow(/API/i);
  });
  it("reports every adapter match without selecting one", () => {
    const adapter = (id: string) => ({
      id,
      supports: () => true,
      probe: async () => ({
        available: false,
        capabilities: [],
        diagnostics: [],
      }),
      createLaunch: async () => ({ command: "node", args: [] }),
    });
    const registry = createRegistry([
      {
        ...plugin(),
        adapters: [adapter("example/one"), adapter("example/two")],
      },
    ]);
    expect(registry.match(candidate)).toEqual(["example/one", "example/two"]);
  });
  it("rejects a duplicate discoverer even in distinct plugins", () => {
    const discoverer = {
      id: "example/discovery",
      sourceKinds: ["file" as const],
      discover: async () => ({
        candidates: [],
        diagnostics: [],
        complete: true,
      }),
    };
    expect(() =>
      createRegistry([
        { ...plugin("example/one"), discoverers: [discoverer] },
        { ...plugin("example/two"), discoverers: [discoverer] },
      ]),
    ).toThrow(/duplicate/i);
  });
  it("loads relative modules from a spaced Unicode manifest directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "causign-plugin-"));
    directories.push(root);
    const directory = join(root, "á directory");
    await mkdir(directory);
    await writeFile(
      join(directory, "plugin.mjs"),
      "export default {id:'example/external',apiVersion:'1',discoverers:[],adapters:[]};",
    );
    await writeFile(
      join(directory, "plugins.json"),
      JSON.stringify({ schemaVersion: "1", plugins: ["./plugin.mjs"] }),
    );
    expect(
      (await loadPluginManifest(join(directory, "plugins.json"))).map(
        (value) => value.id,
      ),
    ).toEqual(["example/external"]);
  });
  it("validates the entire manifest before importing any code", async () => {
    const root = await mkdtemp(join(tmpdir(), "causign-invalid-"));
    directories.push(root);
    await writeFile(
      join(root, "plugin.mjs"),
      "throw new Error('MODULE EXECUTED');",
    );
    await writeFile(
      join(root, "plugins.json"),
      JSON.stringify({
        schemaVersion: "1",
        plugins: ["./plugin.mjs"],
        unknown: true,
      }),
    );
    await expect(
      loadPluginManifest(join(root, "plugins.json")),
    ).rejects.toThrow(/manifest/i);
  });
  it("a failed manifest does not mutate an existing registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "causign-transaction-"));
    directories.push(root);
    const registry = createRegistry([plugin()]);
    await writeFile(
      join(root, "plugins.json"),
      JSON.stringify({ schemaVersion: "1", plugins: ["./missing.mjs"] }),
    );
    await expect(
      loadPluginManifest(join(root, "plugins.json")),
    ).rejects.toThrow();
    expect(registry.plugins.map((value) => value.id)).toEqual([
      "example/plugin",
    ]);
  });
  it("rejects malformed plugin methods at registration", () => {
    expect(() =>
      createRegistry([
        { ...plugin(), adapters: [{ id: "example/bad" }] as never },
      ]),
    ).toThrow(/adapter/i);
  });
  it("loads installed ESM packages with import-only exports from the manifest location", async () => {
    const root = await mkdtemp(join(tmpdir(), "causign-esm-plugin-"));
    directories.push(root);
    const module = join(root, "node_modules", "example-plugin");
    await mkdir(module, { recursive: true });
    await writeFile(
      join(module, "package.json"),
      JSON.stringify({
        name: "example-plugin",
        type: "module",
        exports: { import: "./plugin.mjs" },
      }),
    );
    await writeFile(
      join(module, "plugin.mjs"),
      "export default {id:'example/esm',apiVersion:'1',discoverers:[],adapters:[]};",
    );
    await writeFile(
      join(root, "plugins.json"),
      JSON.stringify({ schemaVersion: "1", plugins: ["example-plugin"] }),
    );
    expect((await loadPluginManifest(join(root, "plugins.json")))[0].id).toBe(
      "example/esm",
    );
  });
});
