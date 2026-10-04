import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createRegistry,
  discoverAgents,
  type Selection,
} from "../../runtime/src/index.js";
import plugin, { probeCodex } from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "causign-codex-"));
  roots.push(root);
  return root;
}
it("refuses output execution even when Codex is installed, without pretending read-only denies tools", async () => {
  const root = await setup();
  await writeFile(join(root, "reviewer.config.toml"), 'model = "example"');
  const candidate = (
    await discoverAgents(createRegistry([plugin]), { kind: "file", path: root })
  ).candidates[0];
  const selection: Selection = {
    candidate,
    adapterId: "causign/codex-output",
    mode: "output",
    target: {
      kind: "native",
      command: process.execPath,
      args: [resolve("fixtures/native-runtimes/codex.mjs")],
      cwd: root,
    },
  };
  const probe = await probeCodex(selection.target);
  expect(probe.available).toBe(true);
  expect(probe.capabilities).toEqual([]);
  expect(
    probe.diagnostics.some((item) => item.code === "codex.profile-unsupported"),
  ).toBe(true);
  await expect(plugin.adapters[0].createLaunch(selection)).rejects.toThrow(
    /tool/i,
  );
});
it("reports unavailable executable and unsupported version", async () => {
  const root = await setup();
  expect(
    (
      await probeCodex({
        kind: "native",
        command: "missing-causign-codex",
        cwd: root,
      })
    ).available,
  ).toBe(false);
  const probe = await probeCodex({
    kind: "native",
    command: process.execPath,
    cwd: root,
  });
  expect(
    probe.diagnostics.some((item) => item.code === "runtime.version"),
  ).toBe(true);
});
