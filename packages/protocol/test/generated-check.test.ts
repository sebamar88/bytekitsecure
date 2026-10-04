import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("generated check accepts CRLF but rejects changed contracts", async () => {
  const root = resolve(".");
  await mkdir(join(root, ".causign"), { recursive: true });
  const fixture = await mkdtemp(join(root, ".causign", "generated-check-"));
  try {
    await mkdir(join(fixture, "scripts"), { recursive: true });
    await mkdir(join(fixture, "packages/protocol/src"), { recursive: true });
    await cp(
      join(root, "scripts/generate-types.mjs"),
      join(fixture, "scripts/generate-types.mjs"),
    );
    await cp(
      join(root, "packages/protocol/schemas"),
      join(fixture, "packages/protocol/schemas"),
      { recursive: true },
    );
    const target = join(fixture, "packages/protocol/src/generated.ts");
    const source = await readFile(
      join(root, "packages/protocol/src/generated.ts"),
      "utf8",
    );
    const check = () =>
      spawnSync(
        process.execPath,
        [join(fixture, "scripts/generate-types.mjs"), "--check"],
        { encoding: "utf8", windowsHide: true },
      );
    await writeFile(target, source.replace(/\r?\n/g, "\r\n"));
    const equivalent = check();
    expect(equivalent.status, equivalent.stderr).toBe(0);
    await writeFile(
      target,
      source.replace(/\r?\n/g, "\r\n") +
        "export type UnexpectedContract = string;\r\n",
    );
    const changed = check();
    expect(changed.status).toBe(1);
    expect(changed.stderr).toContain("Generated contracts are stale");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}, 15000);
