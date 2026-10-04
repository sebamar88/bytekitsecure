import { it, expect } from "vitest";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { reportCommand, viewReport } from "../../src/report/command.js";
import { main } from "../../src/main.js";
import { root } from "./fixtures.js";
import type { ReportServerOptions } from "../../src/report/server.js";
it("reports without importing config and no-open does not launch a browser", async () => {
  const cwd = await root();
  await writeFile(
    join(cwd, "causign.config.ts"),
    "throw new Error('must not import');",
  );
  const controller = new AbortController();
  const lines: string[] = [];
  const code = await reportCommand(["--output-dir", cwd, "--no-open"], {
    cwd,
    signal: controller.signal,
    stdout: (line) => {
      lines.push(line);
      if (line.startsWith("Local report:")) controller.abort();
    },
    stderr: (line) => lines.push(line),
  });
  expect(code).toBe(0);
  expect(lines.join(" ")).toContain("127.0.0.1");
  expect(lines.join(" ")).toContain("Ctrl+C");
});
it("browser opening failure leaves a usable URL", async () => {
  const cwd = await root();
  const controller = new AbortController();
  const lines: string[] = [];
  const code = await reportCommand(
    ["--output-dir", cwd],
    {
      cwd,
      signal: controller.signal,
      stdout: (s) => lines.push(s),
      stderr: (s) => {
        lines.push(s);
        controller.abort();
      },
    },
    {
      openBrowser: async () => {
        throw new Error("browser unavailable");
      },
    },
  );
  expect(code).toBe(0);
  expect(lines.join(" ")).toContain("Local report: http://127.0.0.1");
  expect(lines.join(" ")).toContain("browser unavailable");
});
it.each([
  ["--port", "0"],
  ["--port", "65536"],
  ["--port", "1.5"],
  ["--port"],
  ["--output-dir"],
  ["--unknown"],
])("rejects invalid report options %j", async (...args: string[]) => {
  const lines: string[] = [];
  expect(
    await main(["report", ...args], {
      cwd: await root(),
      stdout: (s) => lines.push(s),
      stderr: (s) => lines.push(s),
    }),
  ).toBe(2);
  expect(lines.join(" ")).toMatch(/port|value|option/i);
});
it("run --open selects its execution and retains the suite exit code", async () => {
  const cwd = await root();
  const lines: string[] = [];
  const io = {
    cwd,
    stdout: (s: string) => lines.push(s),
    stderr: (s: string) => lines.push(s),
  };
  expect(await main(["init"], io)).toBe(0);
  const scenario = await readFile(join(cwd, "sample.causign.ts"), "utf8");
  let options: ReportServerOptions | undefined;
  const viewer = async (o: ReportServerOptions) => {
    options = o;
  };
  for (const [replacement, want] of [
    ["Hello from Causign", 0],
    ["different", 1],
  ] as const) {
    await writeFile(
      join(cwd, "sample.causign.ts"),
      scenario.replace(
        "greeting:'Hello from Causign'",
        `greeting:'${replacement}'`,
      ),
    );
    expect(await main(["run", "--open"], io, { viewReport: viewer })).toBe(
      want,
    );
    expect(options?.root).toBe(join(cwd, ".causign/results"));
    expect(options?.selectedReportId).toMatch(/^[a-f0-9]{24}$/);
  }
  await writeFile(
    join(cwd, "sample-agent.mjs"),
    "process.stdout.write('invalid\\n');",
  );
  expect(await main(["run", "--open"], io, { viewReport: viewer })).toBe(2);
});
it("viewer failure preserves verdict; plain run and artifact failure do not start a viewer", async () => {
  const cwd = await root();
  const lines: string[] = [];
  const io = {
    cwd,
    stdout: (s: string) => lines.push(s),
    stderr: (s: string) => lines.push(s),
  };
  await main(["init"], io);
  let count = 0;
  const services = {
    viewReport: async () => {
      count++;
      throw new Error("viewer unavailable");
    },
  };
  expect(await main(["run"], io, services)).toBe(0);
  expect(count).toBe(0);
  expect(await main(["run", "--open"], io, services)).toBe(0);
  expect(count).toBe(1);
  expect(lines.join(" ")).toContain("causign report");
  await writeFile(join(cwd, "blocker"), "file");
  expect(
    await main(["run", "--open", "--output-dir", "blocker"], io, services),
  ).toBe(2);
  expect(count).toBe(1);
});
it("interrupting execution starts no viewer and preserves 130", async () => {
  const cwd = await root();
  const controller = new AbortController();
  const io = {
    cwd,
    signal: controller.signal,
    stdout: () => {},
    stderr: () => {},
  };
  await main(["init"], io);
  await writeFile(join(cwd, "sample-agent.mjs"), "setInterval(()=>{},1000);");
  let viewed = false;
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    expect(
      await main(["run", "--open"], io, {
        viewReport: async () => {
          viewed = true;
        },
      }),
    ).toBe(130);
    expect(viewed).toBe(false);
  } finally {
    clearTimeout(timer);
  }
});
it.each([0, 1, 2])(
  "real viewer shutdown retains suite exit code %s",
  async (code) => {
    const cwd = await root();
    const controller = new AbortController();
    let opened = false;
    const io = {
      cwd,
      signal: controller.signal,
      stdout: (s: string) => {
        if (s.startsWith("Local report:")) {
          opened = true;
          controller.abort();
        }
      },
      stderr: () => {},
    };
    await main(["init"], io);
    if (code === 1) {
      const path = join(cwd, "sample.causign.ts");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace(
          "greeting:'Hello from Causign'",
          "greeting:'different'",
        ),
      );
    }
    if (code === 2)
      await writeFile(
        join(cwd, "sample-agent.mjs"),
        "process.stdout.write('invalid\\n');",
      );
    expect(
      await main(["run", "--open"], io, {
        viewReport: (options, output) => viewReport(options, output, {}, true),
      }),
    ).toBe(code);
    expect(opened).toBe(true);
  },
);
it("cancellation at the execution-viewer boundary preserves the completed verdict", async () => {
  const cwd = await root();
  const controller = new AbortController();
  let viewed = false;
  const io = {
    cwd,
    signal: controller.signal,
    stdout: (s: string) => {
      if (s.startsWith("Artifacts directory:")) controller.abort();
    },
    stderr: () => {},
  };
  await main(["init"], io);
  expect(
    await main(["run", "--open"], io, {
      viewReport: async () => {
        viewed = true;
      },
    }),
  ).toBe(0);
  expect(viewed).toBe(false);
});
