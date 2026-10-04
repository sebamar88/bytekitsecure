import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  createRegistry,
  loadPluginManifest,
  discoverAgents,
  type Selection,
} from "../../packages/runtime/src/index.js";
import { runScenario } from "../../packages/core/src/execute.js";
import type { ScenarioDefinition } from "@causign/protocol";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
it("loads an external framework and runs through the existing core without a vendor catalogue edit", async () => {
  const root = await mkdtemp(join(tmpdir(), "causign-external-"));
  roots.push(root);
  await cp(resolve("fixtures/runtime-plugins"), join(root, "plugins"), {
    recursive: true,
  });
  // Fixture package import resolves from its location; use workspace runtime URL for this source test.
  for (const name of ["custom-framework.mjs", "bridge.mjs"]) {
    const { readFile } = await import("node:fs/promises");
    const file = join(root, "plugins", name);
    await writeFile(
      file,
      (await readFile(file, "utf8")).replaceAll(
        '"@causign/runtime"',
        JSON.stringify(
          new URL("../../packages/runtime/dist/index.js", import.meta.url).href,
        ),
      ),
    );
  }
  await writeFile(
    join(root, "example-agent.json"),
    JSON.stringify({
      framework: "example",
      name: "External Agent",
      text: "hello",
    }),
  );
  await writeFile(
    join(root, "plugins.json"),
    JSON.stringify({
      schemaVersion: "1",
      plugins: ["./plugins/custom-framework.mjs"],
    }),
  );
  const registry = createRegistry(
      await loadPluginManifest(join(root, "plugins.json")),
    ),
    report = await discoverAgents(registry, { kind: "file", path: root });
  expect(report.complete).toBe(true);
  expect(report.candidates).toHaveLength(1);
  expect(report.candidates[0].adapterIds).toEqual([
    "example/alternate",
    "example/output",
  ]);
  const adapter = registry.adapters.find(
      (item) => item.id === "example/output",
    )!,
    selection: Selection = {
      adapterId: adapter.id,
      candidate: report.candidates[0],
      mode: "output",
      target: { kind: "native", cwd: root },
    };
  expect(
    (await adapter.probe(selection.target, selection)).capabilities,
  ).toEqual(["observe.output"]);
  const launch = await adapter.createLaunch(selection),
    config = {
      schemaVersion: "1" as const,
      agents: { agent: launch },
      evaluators: {},
    };
  const scenario: ScenarioDefinition = {
    schemaVersion: "1",
    id: "external",
    name: "external",
    agent: "agent",
    input: null,
    mocks: [],
    assertions: [
      {
        id: "text",
        type: "output.equal",
        parameters: { value: { text: "hello" } },
        negated: false,
        requirements: [],
      },
    ],
    requirements: [],
    timeoutMs: 2000,
  };
  const pass = await runScenario(scenario, config);
  expect(pass.status, JSON.stringify(pass)).toBe("PASS");
  expect(
    (
      await runScenario(
        {
          ...scenario,
          assertions: [
            {
              ...scenario.assertions[0],
              parameters: { value: { text: "wrong" } },
            },
          ],
        },
        config,
      )
    ).status,
  ).toBe("FAIL");
  expect(
    (await runScenario({ ...scenario, input: "error" }, config)).status,
  ).toBe("ERROR");
  expect(
    (
      await runScenario(
        { ...scenario, requirements: ["observe.toolExecution"] },
        config,
      )
    ).status,
  ).toBe("INCOMPATIBLE");
}, 10000);
