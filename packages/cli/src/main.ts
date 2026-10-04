import { resolve, dirname, isAbsolute, basename } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { validateConfig } from "@causign/protocol";
import type { EvaluatorModule } from "@causign/core";
import { discover, collectScenarios, importUserModule } from "./discover.js";
import { initialize } from "./init.js";
import { inspectDefinitions } from "./inspect.js";
import { runDefinitions } from "./run.js";
import { reportConsole } from "./reporters/console.js";
import { discoverCommand } from "./agent-discovery.js";
import { reportCommand, viewReport } from "./report/command.js";
export interface CliIO {
  cwd?: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  signal?: AbortSignal;
}
const help =
  "Usage: causign init | discover --path root [--discoverer id] [--plugins manifest.json] [--json] | discover --source id --plugins manifest.json [--json] | inspect [files/globs] [--config path] | run [files/globs] [--config path] [--verbose] [--output-dir path] [--open] | report [--output-dir path] [--port number] [--no-open]";
export interface CliServices {
  viewReport?: typeof viewReport;
}
export async function main(
  argv: string[],
  io: CliIO,
  services: CliServices = {},
): Promise<number> {
  try {
    const cwd = resolve(io.cwd ?? process.cwd());
    const [command, ...args] = argv;
    if (command === "--help" || command === "-h") {
      io.stdout(help);
      return 0;
    }
    if (command === "discover") return await discoverCommand(args, io);
    if (command === "report") return await reportCommand(args, io);
    if (!["init", "inspect", "run"].includes(command)) throw new Error(help);
    let configName = "causign.config.ts",
      output = ".causign/results",
      verbose = false,
      open = false;
    const filters: string[] = [];
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--config" || arg === "--output-dir") {
        const value = args[++index];
        if (!value || value.startsWith("--"))
          throw new Error(`Missing value for ${arg}`);
        if (arg === "--config") configName = value;
        else output = value;
      } else if (arg === "--verbose") verbose = true;
      else if (arg === "--open" && command === "run") open = true;
      else if (arg.startsWith("-")) throw new Error(`Unknown option ${arg}`);
      else filters.push(arg);
    }
    if (command === "init") {
      if (args.length) throw new Error("init takes no options");
      io.stdout(
        (await initialize(cwd)).map((path) => `Created ${path}`).join("\n"),
      );
      return 0;
    }
    const configPath = resolve(cwd, configName),
      configDirectory = dirname(configPath);
    const config = structuredClone(
      validateConfig((await importUserModule(configPath)).default),
    );
    for (const agent of Object.values(config.agents))
      agent.cwd = resolve(configDirectory, agent.cwd ?? ".");
    const files = await discover(configDirectory, filters);
    if (!files.length) throw new Error("No scenarios matched discovery/filter");
    const definitions = await collectScenarios(files);
    if (!definitions.length) throw new Error("Empty scenario collection");
    if (command === "inspect") {
      io.stdout(
        JSON.stringify(inspectDefinitions(definitions, config), null, 2),
      );
      return io.signal?.aborted ? 130 : 0;
    }
    const result = await runDefinitions(
      definitions,
      config,
      resolve(cwd, output),
      {
        signal: io.signal,
        evaluatorModuleLoader: async (specifier) => {
          const path = specifier.startsWith("file:")
            ? fileURLToPath(specifier)
            : isAbsolute(specifier) || specifier.startsWith(".")
              ? resolve(configDirectory, specifier)
              : createRequire(pathToFileURL(configPath)).resolve(specifier);
          return (await importUserModule(path)) as unknown as EvaluatorModule;
        },
      },
    );
    io.stdout(reportConsole(result.suite, { verbose }));
    if (result.artifactsWritten)
      io.stdout(
        `Artifacts directory: ${result.directory}\nResults: ${result.paths.results}\n${Object.values(
          result.paths.plans,
        )
          .map((path) => `Plan: ${path}`)
          .join("\n")}\n${Object.values(result.paths.traces)
          .map((path) => `Trace: ${path}`)
          .join("\n")}`,
      );
    else
      io.stdout(
        `Intended artifact directory (unverified): ${result.directory}`,
      );
    if (
      open &&
      result.artifactsWritten &&
      !result.suite.interrupted &&
      !io.signal?.aborted
    ) {
      try {
        await (services.viewReport ?? viewReport)(
          {
            root: resolve(cwd, output),
            selectedReportId: createHash("sha256")
              .update(basename(result.directory))
              .digest("hex")
              .slice(0, 24),
            signal: io.signal,
          },
          io,
        );
      } catch (error) {
        io.stderr(
          `Report viewer unavailable: ${error instanceof Error ? error.message : String(error)}. Retry with causign report --output-dir ${JSON.stringify(resolve(cwd, output))}. Suite verdict and exit code are preserved.`,
        );
      }
    }
    return result.suite.exitCode;
  } catch (error) {
    io.stderr(
      `ERROR: ${error instanceof Error ? error.message : String(error)}`,
    );
    return io.signal?.aborted ? 130 : 2;
  }
}
