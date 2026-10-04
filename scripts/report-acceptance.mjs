import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
export async function runReportAcceptance({ bin, cwd }) {
  const resultsRoot = join(cwd, ".causign", "viewer-acceptance");
  const dir = join(resultsRoot, "2026-10-02T12-00-00-000Z-failure");
  await mkdir(dir, { recursive: true });
  const result = {
    schemaVersion: "1",
    scenarioId: "packed-failure",
    status: "FAIL",
    planId: "p",
    traceId: "t",
    runId: "r",
    assertions: [
      {
        id: "a",
        status: "FAIL",
        expected: "expected greeting",
        observed: "actual greeting",
        reason: "Recorded JSON comparison.",
        evidence: [{ kind: "message", messageId: "m" }],
      },
    ],
    diagnostics: [],
  };
  const plan = {
    id: "p",
    scenarioId: "packed-failure",
    agent: { command: "fixture", args: [] },
    protocol: "causign/1",
    capabilities: ["observe.output"],
    input: null,
    requirements: [],
    interceptions: [],
    approvalDecisions: [],
    assertions: [
      {
        id: "a",
        type: "output.equal",
        parameters: { value: { greeting: "expected" } },
        negated: false,
        requirements: [],
      },
    ],
    limits: { scenarioTimeoutMs: 1000 },
  };
  const trace = {
    schemaVersion: "1",
    id: "t",
    planId: "p",
    runId: "r",
    completeness: "complete",
    diagnostics: [],
    terminal: { type: "run.completed", messageId: "m", source: "adapter" },
    events: [
      {
        receiveSequence: 1,
        source: "adapter",
        message: {
          protocol: "causign/1",
          id: "m",
          runId: "r",
          type: "run.completed",
          timestamp: "2026-10-02T12:00:00Z",
          payload: { output: { greeting: "actual" } },
        },
      },
    ],
  };
  await Promise.all([
    writeFile(
      join(dir, "results.json"),
      JSON.stringify({
        schemaVersion: "1",
        results: [result],
        diagnostics: [],
        exitCode: 1,
        interrupted: false,
      }),
    ),
    writeFile(
      join(dir, "plan-1.json"),
      JSON.stringify({ schemaVersion: "1", plan }),
    ),
    writeFile(join(dir, "trace-1.json"), JSON.stringify(trace)),
  ]);
  const script = `process.argv=['node',${JSON.stringify(bin)},'report','--no-open','--output-dir',${JSON.stringify(resultsRoot)}];process.stdin.once('data',()=>process.emit('SIGINT'));await import(${JSON.stringify(pathToFileURL(bin).href)});process.stdin.pause();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    shell: false,
    windowsHide: true,
  });
  let stdout = "",
    stderr = "";
  let resolveURL, rejectURL;
  const urlReady = new Promise((resolve, reject) => {
    resolveURL = resolve;
    rejectURL = reject;
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    const match = /Local report: (http:\/\/127\.0\.0\.1:\d+\/#[a-f0-9]+)/.exec(
      stdout,
    );
    if (match) resolveURL(match[1]);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", rejectURL);
  child.once("close", (code) =>
    rejectURL(new Error(`Report stopped before opening (${code}): ${stderr}`)),
  );
  const timer = setTimeout(() => {
    rejectURL(new Error("Report startup timed out."));
    child.kill();
  }, 15000);
  try {
    const url = new URL(await urlReady);
    const headers = { Authorization: `Bearer ${url.hash.slice(1)}` };
    const base = url.origin;
    for (const path of [
      "/",
      "/style.css",
      "/client.js",
      "/session.js",
      "/navigation.js",
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, `Packed asset ${path}`);
      assert((await response.text()).length > 0);
    }
    assert.equal((await fetch(base + "/api/history")).status, 401);
    const history = await (
      await fetch(base + "/api/history", { headers })
    ).json();
    assert.equal(history.reports[0].counts.FAIL, 1);
    const d = await (
      await fetch(`${base}/api/reports/${history.reports[0].id}/scenarios/0`, {
        headers,
      })
    ).json();
    assert.equal(d.explanations[0].differences[0].path, "/greeting");
    assert.equal(d.explanations[0].evidence[0].available, true);
    child.stdin.end("stop");
    assert.equal(
      await closed,
      0,
      "Report viewing preserves command success despite historical FAIL",
    );
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) child.kill();
    await closed;
  }
}
