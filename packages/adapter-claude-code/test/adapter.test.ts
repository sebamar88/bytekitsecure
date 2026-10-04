import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { runScenario } from "../../core/src/execute.js";
import type { ScenarioDefinition } from "@causign/protocol";
import {
  createRegistry,
  discoverAgents,
  type Selection,
} from "../../runtime/src/index.js";
import plugin, {
  translateClaudeResult,
  buildClaudeLaunch,
} from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup(
  content = "---\nname: Anthropologist\ndescription: Cultural systems\ncolor: red\n---\nYou are an anthropologist.",
) {
  const root = await mkdtemp(join(tmpdir(), "causign-claude-"));
  roots.push(root);
  const path = join(root, "agent.md");
  await writeFile(path, content);
  return { root, path };
}
it("preserves native names and emits diagnostics for unknown metadata", async () => {
  const { root } = await setup();
  const result = await discoverAgents(createRegistry([plugin]), {
    kind: "file",
    path: root,
  });
  expect(result.candidates[0]).toMatchObject({
    name: "Anthropologist",
    nativeSelector: "Anthropologist",
    kind: "agent",
    adapterIds: ["causign/claude-output"],
  });
  expect(
    result.diagnostics.some((item) => item.code === "claude.metadata"),
  ).toBe(true);
});
it.each([
  "---\nname: bad:name\ndescription: desc\n---\nPrompt",
  "---\nname: [broken\n---\nPrompt",
  "---\nname: missing-description\n---\nPrompt",
])("rejects invalid native definitions", async (content) => {
  const { root } = await setup(content);
  const result = await discoverAgents(createRegistry([plugin]), {
    kind: "file",
    path: root,
  });
  expect(result.candidates).toHaveLength(0);
  expect(result.diagnostics.some((item) => item.severity === "error")).toBe(
    true,
  );
});
it("reports duplicate selectors instead of choosing by scan order", async () => {
  const { root, path } = await setup();
  await writeFile(
    join(root, "duplicate.md"),
    await (await import("node:fs/promises")).readFile(path, "utf8"),
  );
  const result = await discoverAgents(createRegistry([plugin]), {
    kind: "file",
    path: root,
  });
  expect(result.complete).toBe(false);
  expect(
    result.diagnostics.some((item) => item.code === "claude.duplicate"),
  ).toBe(true);
});
it("builds literal tool-disabled launch arguments from the inspected definition", async () => {
  const { root } = await setup();
  const candidate = (
    await discoverAgents(createRegistry([plugin]), { kind: "file", path: root })
  ).candidates[0];
  const selection: Selection = {
    candidate,
    adapterId: "causign/claude-output",
    mode: "output",
    target: { kind: "native", command: "claude", cwd: root },
  };
  const launch = await buildClaudeLaunch(selection, "What is culture?");
  expect(launch.command).toBe("claude");
  expect(launch.stdin).toBe("What is culture?");
  expect(launch.args).toContain("--restricted");
  expect(
    launch.args.slice(
      launch.args.indexOf("--tools"),
      launch.args.indexOf("--tools") + 2,
    ),
  ).toEqual(["--tools", ""]);
  expect(
    JSON.parse(launch.args[launch.args.indexOf("--agents") + 1]).Anthropologist
      .prompt,
  ).toContain("anthropologist");
  await writeFile(
    candidate.source.kind === "file" ? candidate.source.path : "",
    "changed",
  );
  await expect(buildClaudeLaunch(selection, "x")).rejects.toThrow(/changed/);
});
it("rejects an invalid WSL execution target before launching", async () => {
  const { root } = await setup();
  const candidate = (
    await discoverAgents(createRegistry([plugin]), { kind: "file", path: root })
  ).candidates[0];
  await expect(
    buildClaudeLaunch(
      {
        candidate,
        adapterId: "causign/claude-output",
        mode: "output",
        target: {
          kind: "wsl",
          distro: "Ubuntu",
          cwd: "\\\\wsl.localhost\\Ubuntu\\home",
        },
      },
      "x",
    ),
  ).rejects.toThrow(/POSIX/);
});
it("only accepts a final successful native result", () => {
  expect(
    translateClaudeResult({
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello",
      }),
      stderr: "",
      exitCode: 0,
      signal: null,
    }),
  ).toEqual({ text: "hello" });
  for (const stdout of [
    "bad",
    JSON.stringify({ type: "assistant", message: "hello" }),
    JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: "oops",
    }),
  ])
    expect(() =>
      translateClaudeResult({ stdout, stderr: "", exitCode: 0, signal: null }),
    ).toThrow();
  expect(() =>
    translateClaudeResult({
      stdout: JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "hello",
      }),
      stderr: "",
      exitCode: 1,
      signal: null,
    }),
  ).toThrow(/exit/i);
});
it("runs fixture output scenarios and negotiates tool incompatibility before native execution", async () => {
  const { root } = await setup();
  const candidate = (
    await discoverAgents(createRegistry([plugin]), { kind: "file", path: root })
  ).candidates[0];
  const adapter = plugin.adapters[0],
    selection: Selection = {
      candidate,
      adapterId: adapter.id,
      mode: "output",
      target: {
        kind: "native",
        command: process.execPath,
        args: [resolve("fixtures/native-runtimes/claude.mjs")],
        cwd: root,
      },
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
    id: "fixture",
    name: "fixture",
    agent: "agent",
    input: "hello",
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
    timeoutMs: 3000,
  };
  const first = await runScenario(scenario, config);
  expect(first.status, JSON.stringify(first)).toBe("PASS");
  expect(
    (await runScenario({ ...scenario, input: "other" }, config)).status,
  ).toBe("FAIL");
  expect(
    (await runScenario({ ...scenario, input: "nonzero" }, config)).status,
  ).toBe("ERROR");
  expect(
    (await runScenario({ ...scenario, input: "malformed" }, config)).status,
  ).toBe("ERROR");
  expect(
    (
      await runScenario(
        {
          ...scenario,
          mocks: [
            {
              type: "tool",
              name: "delete",
              response: { kind: "result", value: null },
            },
          ],
        },
        config,
      )
    ).status,
  ).toBe("INCOMPATIBLE");
}, 15000);
it.each(["cancel", "timeout"])(
  "cleans native process through core → bridge after %s",
  async (mode) => {
    const { root } = await setup(),
      marker = join(root, "native.pid");
    let pid: number | undefined;
    const candidate = (
        await discoverAgents(createRegistry([plugin]), {
          kind: "file",
          path: root,
        })
      ).candidates[0],
      adapter = plugin.adapters[0];
    const selection: Selection = {
      candidate,
      adapterId: adapter.id,
      mode: "output",
      target: {
        kind: "native",
        command: process.execPath,
        args: [resolve("fixtures/native-runtimes/claude.mjs")],
        cwd: root,
      },
    };
    const agent = await adapter.createLaunch(selection),
      controller = new AbortController();
    const scenario: ScenarioDefinition = {
      schemaVersion: "1",
      id: "cleanup",
      name: "cleanup",
      agent: "agent",
      input: `stall:${marker}`,
      mocks: [],
      assertions: [],
      requirements: [],
      timeoutMs: mode === "timeout" ? 1000 : 5000,
    };
    const pending = runScenario(
      scenario,
      { schemaVersion: "1", agents: { agent }, evaluators: {} },
      { signal: controller.signal },
    );
    try {
      for (let tries = 0; tries < 150; tries++) {
        try {
          pid = Number(await readFile(marker, "utf8"));
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      expect(pid).toBeTypeOf("number");
      if (mode === "cancel") controller.abort();
      expect((await pending).status).toBe("ERROR");
      await new Promise((resolve) => setTimeout(resolve, 400));
      let alive = true;
      try {
        process.kill(pid!, 0);
      } catch {
        alive = false;
      }
      expect(alive).toBe(false);
    } finally {
      controller.abort();
      await pending;
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          /* Test does not leave an orphan on failure. */
        }
    }
  },
  10000,
);
