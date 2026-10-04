import { it, expect } from "vitest";
import { planPublication } from "./publish-packages.mjs";
const pkg = (name, dependencies = {}) => ({
  name: `@causign/${name}`,
  version: "0.1.2",
  dependencies,
  directory: name,
});
it("publishes missing dependencies before consumers and skips existing versions", async () => {
  const packages = [
    pkg("cli", { "@causign/core": "workspace:*" }),
    pkg("core", { "@causign/protocol": "workspace:*" }),
    pkg("protocol"),
  ];
  expect(
    (
      await planPublication(
        packages,
        async (p) => p.name === "@causign/protocol",
      )
    ).map((p) => p.name),
  ).toEqual(["@causign/core", "@causign/cli"]);
});
it("does not publish when registry availability cannot be established", async () => {
  await expect(
    planPublication([pkg("core")], async () => {
      throw new Error("Registry 503");
    }),
  ).rejects.toThrow("Registry 503");
});
it("rejects dependency cycles", async () => {
  await expect(
    planPublication(
      [
        pkg("core", { "@causign/cli": "workspace:*" }),
        pkg("cli", { "@causign/core": "workspace:*" }),
      ],
      async () => false,
    ),
  ).rejects.toThrow("cycle");
});
it("returns an empty plan for a previously completed release", async () => {
  expect(await planPublication([pkg("core")], async () => true)).toEqual([]);
});
