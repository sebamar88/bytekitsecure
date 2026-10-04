import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistry,
  discoverAgents,
  instructionPlugin,
  verifyCandidateRevision,
} from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "causign-discovery-"));
  roots.push(root);
  return root;
}
const registry = () => createRegistry([instructionPlugin]);
it("discovers instructions without pretending they are executable", async () => {
  const root = await setup();
  await writeFile(join(root, "AGENTS.md"), "# Context");
  await writeFile(
    join(root, "evil.mjs"),
    "throw new Error('MUST NOT IMPORT');",
  );
  const result = await discoverAgents(registry(), { kind: "file", path: root });
  expect(result.complete).toBe(true);
  expect(result.candidates).toHaveLength(1);
  expect(result.candidates[0]).toMatchObject({
    kind: "instructions",
    adapterIds: [],
  });
});
it("excludes generated directories and never follows directory symlinks", async () => {
  const root = await setup(),
    outside = await setup();
  await writeFile(join(outside, "AGENTS.md"), "outside");
  await symlink(
    outside,
    join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const name of [
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".git",
    ".causign",
    ".superpowers",
  ]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "AGENTS.md"), "ignored");
  }
  expect(
    (await discoverAgents(registry(), { kind: "file", path: root })).candidates,
  ).toEqual([]);
});
it("keeps identity across revisions and detects stale candidate content", async () => {
  const root = await setup(),
    file = join(root, "AGENTS.md");
  await writeFile(file, "one");
  const first = (await discoverAgents(registry(), { kind: "file", path: root }))
    .candidates[0];
  await verifyCandidateRevision(first);
  await writeFile(file, "two");
  const second = (
    await discoverAgents(registry(), { kind: "file", path: root })
  ).candidates[0];
  expect(second.id).toBe(first.id);
  expect(second.revision).not.toBe(first.revision);
  await expect(verifyCandidateRevision(first)).rejects.toThrow(/changed/i);
});
it("separates equal display names from distinct sources", async () => {
  const root = await setup();
  for (const name of ["a", "b"]) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "AGENTS.md"), "same");
  }
  const candidates = (
    await discoverAgents(registry(), { kind: "file", path: root })
  ).candidates;
  expect(candidates).toHaveLength(2);
  expect(candidates[0].id).not.toBe(candidates[1].id);
});
it.each([{ maxFiles: 1 }, { maxFileBytes: 2 }, { maxTotalBytes: 3 }])(
  "reports incomplete discovery when limited by %j",
  async (limits) => {
    const root = await setup();
    await writeFile(join(root, "AGENTS.md"), "large");
    await writeFile(join(root, "other.md"), "large");
    const result = await discoverAgents(
      registry(),
      { kind: "file", path: root },
      { limits },
    );
    expect(result.complete).toBe(false);
    expect(result.diagnostics.some((item) => item.code === "scan.limit")).toBe(
      true,
    );
  },
);
it("reports missing sources rather than a successful empty scan", async () => {
  const result = await discoverAgents(registry(), {
    kind: "file",
    path: join(await setup(), "missing"),
  });
  expect(result.complete).toBe(false);
  expect(result.diagnostics[0].severity).toBe("error");
});
it("honors cancellation before filesystem work", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await discoverAgents(
    registry(),
    { kind: "file", path: await setup() },
    { signal: controller.signal },
  );
  expect(result.complete).toBe(false);
  expect(
    result.diagnostics.some((item) => item.code === "scan.cancelled"),
  ).toBe(true);
});
it("times out a cooperative plugin without returning an apparently complete scan", async () => {
  const plugin = {
    id: "test/slow",
    apiVersion: "1" as const,
    adapters: [],
    discoverers: [
      {
        id: "test/discovery",
        sourceKinds: ["file" as const],
        discover: async () => new Promise<never>(() => {}),
      },
    ],
  };
  const result = await discoverAgents(
    createRegistry([plugin]),
    { kind: "file", path: await setup() },
    { limits: { timeoutMs: 10 } },
  );
  expect(result.complete).toBe(false);
  expect(result.diagnostics.some((item) => item.code === "scan.timeout")).toBe(
    true,
  );
});
it("rejects invalid limits and unknown discoverer filters", async () => {
  await expect(
    discoverAgents(
      registry(),
      { kind: "file", path: await setup() },
      { limits: { maxFiles: 0 } },
    ),
  ).rejects.toThrow(/limit/i);
  await expect(
    discoverAgents(
      registry(),
      { kind: "file", path: await setup() },
      { discovererId: "test/missing" },
    ),
  ).rejects.toThrow(/discoverer/i);
});
it("reports an unrecognized format explicitly", async () => {
  const root = await setup();
  await writeFile(join(root, "unknown.agent"), "opaque");
  const result = await discoverAgents(registry(), { kind: "file", path: root });
  expect(result.candidates).toEqual([]);
  expect(
    result.diagnostics.some((item) => item.code === "source.unrecognized"),
  ).toBe(true);
});
it("reports an explicit symlink root as unsupported instead of a successful empty scan", async () => {
  const root = await setup(),
    outside = await setup();
  await symlink(
    outside,
    join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = await discoverAgents(registry(), {
    kind: "file",
    path: join(root, "link"),
  });
  expect(result.complete).toBe(false);
  expect(
    result.diagnostics.some((item) => item.code === "scan.unsupported-root"),
  ).toBe(true);
});
