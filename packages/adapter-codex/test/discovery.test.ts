import { expect, it } from "vitest";
import { candidateId, type SourceFile } from "@causign/runtime";
import { codexDiscoverer } from "../src/discover.js";
const file = (path: string, text: string): SourceFile => ({
  path,
  text,
  revision: `revision:${path}`,
});
const discover = (files: SourceFile[]) =>
  codexDiscoverer.discover(
    { kind: "file", path: "/profiles" },
    {
      files,
      signal: new AbortController().signal,
      limits: {
        maxFiles: 100,
        maxFileBytes: 10000,
        maxTotalBytes: 100000,
        timeoutMs: 1000,
      },
    },
  );
it.each([
  ["broken.config.toml", "model = [", "Invalid TOML"],
  ["config.toml", "model = [", "Invalid TOML configuration"],
  ["bad name.config.toml", 'model = "m"', "Invalid native profile selector"],
  ["review.config.toml", "model = 42", "Invalid model metadata"],
  [
    "review.config.toml",
    "model_provider = false",
    "Invalid model_provider metadata",
  ],
])(
  "reports invalid profile %s while preserving valid candidates",
  async (path, text, message) => {
    const valid = file(
      "/profiles/valid.config.toml",
      'model = "m"\nmodel_provider = "p"',
    );
    const invalid = file(`/profiles/${path}`, text);
    const result = await discover([invalid, valid]);
    expect(result.complete).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      id: candidateId("causign/codex-config", valid.path, "valid"),
      nativeSelector: "valid",
      revision: valid.revision,
      source: { kind: "file", path: valid.path },
      metadata: {
        definitionFormat: "codex-profile-v2",
        model: "m",
        provider: "p",
      },
    });
    expect(result.diagnostics[0]).toMatchObject({
      code: "codex.definition",
      severity: "error",
      source: invalid.path,
    });
    if (message !== "Invalid TOML")
      expect(result.diagnostics[0].message).toBe(message);
  },
);
it("keeps the first duplicate selector with its exact diagnostic", async () => {
  const first = file("/a/review.config.toml", 'model = "first"'),
    second = file("/b/review.config.toml", 'model = "second"');
  const result = await discover([first, second]);
  expect(result.complete).toBe(false);
  expect(result.candidates.map((c) => c.id)).toEqual([
    candidateId("causign/codex-config", first.path, "review"),
  ]);
  expect(result.diagnostics).toEqual([
    {
      code: "codex.definition",
      message: "Duplicate native profile selector",
      source: second.path,
      severity: "error",
    },
  ]);
});
it("preserves ordering, revisions and optional metadata without treating instructions as agents", async () => {
  const first = file("/profiles/first.config.toml", ""),
    second = file("/profiles/second.config.toml", 'model = ""');
  const result = await discover([
    file("/profiles/AGENTS.md", "context"),
    first,
    file("/profiles/other.toml", "broken"),
    second,
  ]);
  expect(result.complete).toBe(true);
  expect(result.diagnostics).toEqual([]);
  expect(
    result.candidates.map((c) => [c.nativeSelector, c.revision, c.metadata]),
  ).toEqual([
    ["first", first.revision, { definitionFormat: "codex-profile-v2" }],
    ["second", second.revision, { definitionFormat: "codex-profile-v2" }],
  ]);
});
it("reports legacy configuration as a warning without making discovery incomplete", async () => {
  const result = await discover([
    file("/profiles/config.toml", '[profiles.old]\nmodel = "m"'),
  ]);
  expect(result.candidates).toEqual([]);
  expect(result.complete).toBe(true);
  expect(result.diagnostics).toEqual([
    {
      code: "codex.legacy-profile",
      message:
        "Embedded profiles are not the reference 0.159.0 native profile format; use explicitly selected <name>.config.toml files",
      source: "/profiles/config.toml",
      severity: "warning",
    },
  ]);
});
it("accepts an ordinary base config as context with no agent candidate", async () => {
  expect(
    await discover([file("/profiles/config.toml", 'model = "m"')]),
  ).toEqual({ candidates: [], diagnostics: [], complete: true });
});
