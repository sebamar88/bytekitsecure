import { readdir } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
import picomatch from "picomatch";
import { tsImport } from "tsx/esm/api";
import { pathToFileURL } from "node:url";
import {
  validateScenarioCollection,
  type ScenarioDefinition,
} from "@causign/protocol";

const excluded = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".causign",
  ".git",
  ".superpowers",
]);
const unix = (path: string) => path.split(sep).join("/");
/** Discovery never follows symlinks, and generated directories are always excluded. */
export async function discover(
  directory: string,
  filters: string[] = [],
): Promise<string[]> {
  const root = resolve(directory),
    files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".causign.ts"))
        files.push(path);
    }
  };
  await walk(root);
  const matches = filters.map((filter) =>
    picomatch(unix(isAbsolute(filter) ? filter : resolve(root, filter)), {
      dot: true,
    }),
  );
  return files
    .filter(
      (file) => !matches.length || matches.some((match) => match(unix(file))),
    )
    .sort((a, b) =>
      unix(relative(root, a)).localeCompare(unix(relative(root, b))),
    );
}
/** Explicit loader is scoped to user modules. These modules execute user code. */
export async function importUserModule(
  path: string,
): Promise<Record<string, unknown>> {
  const loaded = await tsImport(pathToFileURL(path).href, {
    parentURL: import.meta.url,
    tsconfig: false,
  });
  // tsx returns a CommonJS namespace for .ts in repositories without type:module.
  const value = loaded.default;
  return value && typeof value === "object" && Object.hasOwn(value, "default")
    ? value
    : loaded;
}
export async function collectScenarios(
  files: string[],
): Promise<ScenarioDefinition[]> {
  const definitions: ScenarioDefinition[] = [];
  for (const file of files) {
    const module = await importUserModule(file);
    let exported = module.default;
    if (exported === undefined && Object.hasOwn(module, "definitions"))
      exported = module.definitions;
    if (exported === undefined)
      throw new Error(
        `${file}: export a default scenario/list or explicit definitions array`,
      );
    const candidates = Array.isArray(exported) ? exported : [exported];
    validateScenarioCollection(candidates as ScenarioDefinition[]);
    definitions.push(...(candidates as ScenarioDefinition[]));
  }
  validateScenarioCollection(definitions);
  return structuredClone(definitions);
}
