import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
export const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
export function command(executable, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
export async function runBuiltAcceptanceSuite(options = {}) {
  const base = options.base ?? root,
    bin = options.bin ?? join(root, "packages/cli/dist/bin.js");
  const cwd = await mkdtemp(join(tmpdir(), "causign release "));
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  const agents = {},
    domains = ["support", "coding", "devops", "rag", "multi-agent"];
  for (const folder of [
    "support",
    "coding",
    "devops",
    "rag",
    "coordinator",
    "vercel",
  ]) {
    agents[folder] = {
      command: process.execPath,
      args: [join(base, "examples", folder, "agent.mjs")],
      cwd: base,
    };
    const scenario = folder === "vercel" ? "scenarios.mjs" : "scenario.mjs";
    await writeFile(
      join(cwd, `${folder}.causign.ts`),
      `export {default} from ${JSON.stringify(pathToFileURL(join(base, "examples", folder, scenario)).href)};`,
    );
  }
  const python = process.env.CAUSIGN_PYTHON ?? "python";
  const version = await command(python, ["--version"]);
  assert.equal(version.exitCode, 0, "Python 3 required; set CAUSIGN_PYTHON");
  assert.match(version.stdout + version.stderr, /Python 3\./);
  agents.python = {
    command: python,
    args: [join(base, "fixtures/python-agent.py")],
    cwd: base,
  };
  await writeFile(
    join(cwd, "python.causign.ts"),
    `export default ${JSON.stringify({ schemaVersion: "1", id: "python-release", name: "Python interoperability", agent: "python", input: null, mocks: [{ type: "tool", name: "lookup", response: { kind: "result", value: { customer: "Mock" } } }], assertions: [{ id: "output", type: "output.equal", parameters: { value: { customer: "Mock" } }, negated: false, requirements: [] }], requirements: [], timeoutMs: 5000 })};`,
  );
  await writeFile(
    join(cwd, "causign.config.ts"),
    `export default ${JSON.stringify({ schemaVersion: "1", agents, evaluators: { citations: { module: pathToFileURL(join(base, "examples/rag/evaluator.mjs")).href } } })};`,
  );
  await mkdir(join(root, ".causign"), { recursive: true });
  const artifacts = await mkdtemp(join(root, ".causign", "acceptance-"));
  const run = await command(
    process.execPath,
    [bin, "run", "--verbose", "--output-dir", join(artifacts, "results")],
    cwd,
  );
  await writeFile(join(artifacts, "stdout.txt"), run.stdout);
  await writeFile(join(artifacts, "stderr.txt"), run.stderr);
  assert.equal(run.exitCode, 0, run.stdout + "\n" + run.stderr);
  const results = JSON.parse(
    await readFile(run.stdout.match(/^Results: (.+)$/m)[1].trim(), "utf8"),
  );
  assert.equal(results.results.length, 7);
  assert(results.results.every((r) => r.status === "PASS"));
  for (const result of results.results) {
    assert(result.traceId);
    assert(result.assertions.every((a) => a.status === "PASS"));
    const trace = JSON.parse(
      await readFile(results.artifacts.traces[result.traceId], "utf8"),
    );
    assert.equal(trace.completeness, "complete");
    assert.equal(trace.terminal.source, "adapter");
    const ids = new Set(trace.events.map((event) => event.message.id));
    for (const assertion of result.assertions)
      for (const evidence of assertion.evidence)
        if (evidence.kind === "message")
          assert(
            ids.has(evidence.messageId),
            "Report evidence must reference an actual trace message",
          );
  }
  return { exitCode: run.exitCode, domains, crossLanguage: true, cwd, results };
}
