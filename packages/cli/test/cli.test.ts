import { it, expect, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { main } from "../src/main.js";
import { inspectDefinitions } from "../src/inspect.js";
import { discover } from "../src/discover.js";
import { runSuite, validateScenarioCollection } from "@causign/core";
import { createScenarioCollector } from "../../sdk/src/dsl.js";
const def: any = {
  schemaVersion: "1",
  id: "s",
  name: "s",
  agent: "a",
  input: null,
  mocks: [],
  assertions: [],
  requirements: [],
  timeoutMs: 100,
};
const config: any = {
  schemaVersion: "1",
  agents: { a: { command: process.execPath, args: [] } },
  evaluators: {},
};
it("inspect does not spawn agents", async () => {
  const spawn = vi.fn();
  expect(JSON.stringify(inspectDefinitions([def], config))).toContain(
    "unverified",
  );
  expect(spawn).not.toHaveBeenCalled();
});
it("validates descriptors before IDs and rejects duplicates before spawning", async () => {
  const getter = vi.fn(() => "s");
  const bad = { ...def };
  Object.defineProperty(bad, "id", { get: getter, enumerable: true });
  expect(() => validateScenarioCollection([bad])).toThrow();
  const spawn = vi.fn();
  await expect(
    runSuite([bad], config, { connectionFactory: spawn }),
  ).rejects.toThrow();
  expect(getter).not.toHaveBeenCalled();
  await expect(
    runSuite([def, def], config, { connectionFactory: spawn }),
  ).rejects.toThrow("Duplicate");
  expect(spawn).not.toHaveBeenCalled();
});
it("collector duplicate rejection is transactional", () => {
  const collector = createScenarioCollector();
  collector.add(def);
  expect(() => collector.add(def)).toThrow("Duplicate");
  expect(collector.definitions).toHaveLength(1);
});
it("discovers explicit files/globs with spaces and excludes generated directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "causign discover "));
  await mkdir(join(dir, "nested space"));
  await writeFile(join(dir, "nested space", "sample.causign.ts"), "");
  for (const name of [
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".causign",
    ".git",
    ".superpowers",
  ]) {
    await mkdir(join(dir, name));
    await writeFile(join(dir, name, "hidden.causign.ts"), "");
  }
  expect(await discover(dir)).toEqual([
    join(dir, "nested space", "sample.causign.ts"),
  ]);
  expect(await discover(dir, ["nested space/*.causign.ts"])).toHaveLength(1);
  expect(await discover(dir, ["dist/hidden.causign.ts"])).toEqual([]);
});
it("init refuses every existing target before writing any starter", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "causign init "));
  await writeFile(join(cwd, "sample.causign.ts"), "mine");
  const lines: string[] = [];
  expect(
    await main(["init"], {
      cwd,
      stdout: (s) => lines.push(s),
      stderr: (s) => lines.push(s),
    }),
  ).toBe(2);
  expect(await readFile(join(cwd, "sample.causign.ts"), "utf8")).toBe("mine");
  await expect(readFile(join(cwd, "causign.config.ts"))).rejects.toThrow();
});
it("invalid config and empty discovery return readable ERROR diagnostics", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "causign empty "));
  await writeFile(join(cwd, "causign.config.ts"), "export default {};");
  const lines: string[] = [];
  expect(
    await main(["inspect"], {
      cwd,
      stdout: (s) => lines.push(s),
      stderr: (s) => lines.push(s),
    }),
  ).toBe(2);
  expect(lines.join("\n")).toContain("config");
});

const bin = join(process.cwd(), "packages/cli/dist/bin.js");
async function built(args: string[], cwd: string, script?: string) {
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    const child = spawn(
      process.execPath,
      script ? ["--input-type=module", "-e", script, ...args] : [bin, ...args],
      { cwd, shell: false },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
async function starter() {
  const cwd = await mkdtemp(join(tmpdir(), "causign built CLI "));
  expect((await built(["init"], cwd)).code).toBe(0);
  return cwd;
}
it("built CLI produces PASS, FAIL, ERROR and INCOMPATIBLE exit codes with versioned evidence artifacts", async () => {
  const cwd = await starter();
  const scenarioPath = join(cwd, "sample.causign.ts");
  const initial = await readFile(scenarioPath, "utf8");
  const pass = await built(["run"], cwd);
  expect(pass.code).toBe(0);
  expect(pass.stdout).toContain("PASS");
  const resultPath = pass.stdout.match(/^Results: (.+)$/m)![1].trim();
  const result = JSON.parse(await readFile(resultPath, "utf8"));
  expect(result.schemaVersion).toBe("1");
  expect(result.results[0].traceId).toBeDefined();
  const plan = JSON.parse(
    await readFile(Object.values(result.artifacts.plans)[0] as string, "utf8"),
  );
  const trace = JSON.parse(
    await readFile(Object.values(result.artifacts.traces)[0] as string, "utf8"),
  );
  expect(plan.schemaVersion).toBe("1");
  expect(plan.plan.id).toBe(result.results[0].planId);
  expect(trace.schemaVersion).toBe("1");
  expect(trace.id).toBe(result.results[0].traceId);
  await writeFile(
    scenarioPath,
    initial.replace("greeting:'Hello from Causign'", "greeting:'different'"),
  );
  expect((await built(["run"], cwd)).code).toBe(1);
  await writeFile(
    scenarioPath,
    initial.replace(
      "requirements:[],timeoutMs",
      "requirements:['observe.cost'],timeoutMs",
    ),
  );
  expect((await built(["run"], cwd)).code).toBe(3);
  await writeFile(scenarioPath, initial);
  await writeFile(
    join(cwd, "sample-agent.mjs"),
    "process.stdout.write('invalid frame\\n');",
  );
  const error = await built(["run", "--verbose"], cwd);
  expect(error.code).toBe(2);
  expect(error.stdout).toContain("ERROR");
}, 15000);
it("built CLI handles SIGINT through AbortController and exits130 after cleanup", async () => {
  const cwd = await starter();
  await writeFile(join(cwd, "sample-agent.mjs"), "setInterval(()=>{},1000);");
  const script = `process.argv=['node',${JSON.stringify(bin)},'run'];setTimeout(()=>process.emit('SIGINT'),250);await import(${JSON.stringify(pathToFileURL(bin).href)});`;
  const result = await built([], cwd, script);
  expect(result.code).toBe(130);
  expect(result.stdout).toContain("Interrupted");
}, 15000);
it("built CLI reports missing discovery, duplicates, empty exports and invalid configuration as errors", async () => {
  const cwd = await starter();
  expect((await built(["run", "nothing*.causign.ts"], cwd)).code).toBe(2);
  await writeFile(
    join(cwd, "duplicate.causign.ts"),
    await readFile(join(cwd, "sample.causign.ts"), "utf8"),
  );
  const duplicate = await built(["run"], cwd);
  expect(duplicate.code).toBe(2);
  expect(duplicate.stderr).toContain("Duplicate scenario ID");
  await writeFile(join(cwd, "duplicate.causign.ts"), "export default [];");
  await writeFile(join(cwd, "sample.causign.ts"), "export default [];");
  expect((await built(["inspect"], cwd)).code).toBe(2);
  await writeFile(join(cwd, "causign.config.ts"), "export default {};");
  expect((await built(["run"], cwd)).code).toBe(2);
}, 15000);
it("absolute config anchors agent cwd and evaluator loading while inspect never imports evaluator", async () => {
  const cwd = await starter();
  const outer = await mkdtemp(join(tmpdir(), "causign outer "));
  await writeFile(
    join(cwd, "judge.ts"),
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(join(cwd, "judge-loaded"))},'yes');export function createEvaluator(){return {async evaluate(){return {status:'PASS',explanation:'judge evidence',score:1};}};}`,
  );
  await writeFile(
    join(cwd, "causign.config.ts"),
    `export default {schemaVersion:'1',agents:{sample:{command:process.execPath,args:['sample-agent.mjs'],cwd:'.'}},evaluators:{judge:{module:'./judge.ts'}}};`,
  );
  await writeFile(
    join(cwd, "sample.causign.ts"),
    `export default ${JSON.stringify({ ...def, agent: "sample", timeoutMs: 5000, assertions: [{ id: "judge", type: "output.satisfies", parameters: { evaluator: "judge", criteria: "greeting" }, negated: false, requirements: [] }] })};`,
  );
  const configPath = join(cwd, "causign.config.ts");
  expect((await built(["inspect", "--config", configPath], outer)).code).toBe(
    0,
  );
  await expect(readFile(join(cwd, "judge-loaded"))).rejects.toThrow();
  const result = await built(
    [
      "run",
      "--config",
      configPath,
      "--output-dir",
      join(outer, "artifacts space"),
    ],
    outer,
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toContain("judge evidence");
  expect(await readFile(join(cwd, "judge-loaded"), "utf8")).toBe("yes");
}, 15000);
it("artifact creation failure preserves execution facts and returns ERROR", async () => {
  const cwd = await starter();
  const blocker = join(cwd, "blocker");
  await writeFile(blocker, "file");
  const result = await built(["run", "--output-dir", blocker], cwd);
  expect(result.code).toBe(2);
  expect(result.stdout).toContain("PASS");
  expect(result.stdout).toContain("artifact-error");
  expect(result.stdout).toContain("Intended artifact directory (unverified):");
  expect(result.stdout).not.toMatch(
    /^(Artifacts directory|Results|Plan|Trace):/m,
  );
});
it("inspect executes no configured agent and verbose exposes runtime invalid raw frames and stderr", async () => {
  const cwd = await starter();
  const agentPath = join(cwd, "sample-agent.mjs");
  const agent = await readFile(agentPath, "utf8");
  const marker = join(cwd, "agent-started");
  await writeFile(
    agentPath,
    `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'yes');\n` +
      agent.replace(
        "if(message.type==='run.start'){",
        `if(message.type==='run.start'){process.stderr.write('runtime stderr');process.stdout.write('runtime invalid frame\\n');`,
      ),
  );
  expect((await built(["inspect"], cwd)).code).toBe(0);
  await expect(readFile(marker)).rejects.toThrow();
  const result = await built(["run", "--verbose"], cwd);
  expect(result.code).toBe(2);
  expect(result.stdout).toContain("rawFrame: runtime invalid frame");
  expect(result.stdout).toContain("runtime stderr");
});
