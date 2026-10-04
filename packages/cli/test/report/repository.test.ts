import { it, expect } from "vitest";
import { writeFile, rm, mkdir, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { createReportRepository } from "../../src/report/repository.js";
import { root, execution, details } from "./fixtures.js";
it("copied_report_uses_local_indexed_artifacts", async () => {
  const path = await root();
  await execution(path);
  const repo = await createReportRepository(path);
  const id = (await repo.list()).reports[0].id;
  expect((await repo.scenario(id, 0)).plan?.id).toBe("p");
  expect((await repo.scenario(id, 0)).trace?.id).toBe("t");
});
it("invalid_run_does_not_hide_history", async () => {
  const path = await root();
  await execution(path);
  await execution(path, "unknown");
  await writeFile(join(path, "unknown/results.json"), "{}");
  const list = await (await createReportRepository(path)).list();
  expect(list.reports).toHaveLength(2);
  expect(list.reports[1].error).toBeTruthy();
});
it("mismatched_ids_do_not_join_evidence", async () => {
  const path = await root();
  const dir = await execution(path);
  const trace = details().trace;
  trace.runId = "another";
  await writeFile(join(dir, "trace-1.json"), JSON.stringify(trace));
  const repo = await createReportRepository(path);
  const d = await repo.scenario((await repo.list()).reports[0].id, 0);
  expect(d.trace).toBeUndefined();
  expect(d.warnings.join(" ")).toMatch(/reference/i);
});
it("missing_trace_retains_assertions", async () => {
  const path = await root();
  const dir = await execution(path);
  await rm(join(dir, "trace-1.json"));
  const repo = await createReportRepository(path);
  const d = await repo.scenario((await repo.list()).reports[0].id, 0);
  expect(d.result.assertions[0].status).toBe("FAIL");
  expect(d.warnings.length).toBeGreaterThan(0);
});
it("rejects unavailable roots but allows an empty existing root", async () => {
  const path = await root();
  expect((await (await createReportRepository(path)).list()).reports).toEqual(
    [],
  );
  await expect(createReportRepository(join(path, "missing"))).rejects.toThrow();
});
it("bounds directory enumeration and reports truncation", async () => {
  const path = await root();
  await Promise.all(
    Array.from({ length: 1001 }, (_, i) => mkdir(join(path, `run-${i}`))),
  );
  const list = await (await createReportRepository(path)).list();
  expect(list.reports.length).toBe(1000);
  expect(list.warnings.join(" ")).toMatch(/truncat/i);
}, 20000);
it("rejects oversized JSON while keeping valid small summary", async () => {
  const path = await root();
  const dir = await execution(path);
  await writeFile(join(dir, "trace-1.json"), " ".repeat(16 * 1024 * 1024 + 1));
  const repo = await createReportRepository(path);
  const d = await repo.scenario((await repo.list()).reports[0].id, 0);
  expect(d.trace).toBeUndefined();
  expect(d.warnings.join(" ")).toMatch(/16 MiB/);
});
it("does not follow directory junctions or linked artifact files", async () => {
  const path = await root();
  const external = await root();
  await execution(external);
  await symlink(
    external,
    join(path, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect((await (await createReportRepository(path)).list()).reports).toEqual(
    [],
  );
  const dir = await execution(path);
  await rm(join(dir, "results.json"));
  await symlink(
    external,
    join(dir, "results.json"),
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    (await (await createReportRepository(path)).list()).reports[0].error,
  ).toBeTruthy();
});
it("rejects traversal and disappeared reports and unsupported schemas", async () => {
  const path = await root();
  const dir = await execution(path);
  const repo = await createReportRepository(path);
  const id = (await repo.list()).reports[0].id;
  await expect(repo.load("../outside")).rejects.toThrow();
  await writeFile(
    join(dir, "results.json"),
    JSON.stringify({ schemaVersion: "2" }),
  );
  await expect(repo.load(id)).rejects.toThrow(/version/i);
  await rm(dir, { recursive: true });
  await expect(repo.load(id)).rejects.toThrow();
});
it("loads the existing INCOMPATIBLE suite exit code 3", async () => {
  const path = await root();
  const dir = await execution(path);
  await writeFile(
    join(dir, "results.json"),
    JSON.stringify({
      schemaVersion: "1",
      results: [
        {
          schemaVersion: "1",
          scenarioId: "unsupported",
          status: "INCOMPATIBLE",
          assertions: [],
          diagnostics: [],
          missingCapabilities: ["intercept.tools"],
        },
      ],
      diagnostics: [],
      exitCode: 3,
      interrupted: false,
    }),
  );
  const repo = await createReportRepository(path);
  expect((await repo.list()).reports[0].exitCode).toBe(3);
});
it("invalidates the repository when its selected root is replaced", async () => {
  const base = await root();
  const path = join(base, "selected");
  await mkdir(path);
  await execution(path);
  const repo = await createReportRepository(path);
  const id = (await repo.list()).reports[0].id;
  await rename(path, join(base, "original"));
  await mkdir(path);
  await execution(path);
  await expect(repo.load(id)).rejects.toThrow(/root.*changed|root.*replaced/i);
  await expect(repo.list()).rejects.toThrow(/root.*changed|root.*replaced/i);
});
