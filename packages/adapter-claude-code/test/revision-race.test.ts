import { expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, discoverAgents } from "../../runtime/src/index.js";
import plugin, { buildClaudeLaunch } from "../src/index.js";
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    readFile: async (...args: Parameters<typeof original.readFile>) => {
      if (String(args[0]).endsWith("race-agent.md"))
        await original.writeFile(
          args[0],
          "---\nname: same\ndescription: same\n---\nCHANGED PROMPT",
        );
      return original.readFile(...args);
    },
  };
});
it("executes the exact bounded snapshot whose revision was verified", async () => {
  const root = await mkdtemp(join(tmpdir(), "causign-revision-race-"));
  try {
    await writeFile(
      join(root, "race-agent.md"),
      "---\nname: same\ndescription: same\n---\nORIGINAL PROMPT",
    );
    const candidate = (
      await discoverAgents(createRegistry([plugin]), {
        kind: "file",
        path: root,
      })
    ).candidates[0];
    const launch = await buildClaudeLaunch(
      {
        adapterId: "causign/claude-output",
        candidate,
        mode: "output",
        target: { kind: "native", cwd: root },
      },
      "input",
    );
    expect(
      JSON.parse(launch.args[launch.args.indexOf("--agents") + 1]).same.prompt,
    ).toBe("ORIGINAL PROMPT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
