import { readFile } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { resolve as resolveModule } from "import-meta-resolve";
import { pathToFileURL } from "node:url";
import type { PluginManifest, RuntimePlugin } from "./types.js";
import { createRegistry } from "./registry.js";
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export async function readPluginManifest(
  path: string,
): Promise<PluginManifest> {
  const raw = await readFile(path, "utf8");
  if (Buffer.byteLength(raw) > 1048576)
    throw new Error("Plugin manifest exceeds byte limit");
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    value.schemaVersion !== "1" ||
    !Array.isArray(value.plugins) ||
    value.plugins.some((item) => typeof item !== "string" || !item.trim()) ||
    Object.keys(value).some(
      (key) => !["schemaVersion", "plugins", "sources"].includes(key),
    )
  )
    throw new Error("Invalid plugin manifest");
  if (value.sources !== undefined) {
    if (!object(value.sources)) throw new Error("Invalid manifest sources");
    for (const source of Object.values(value.sources)) {
      if (
        !object(source) ||
        typeof source.discovererId !== "string" ||
        !object(source.options) ||
        Object.keys(source).some(
          (key) => !["discovererId", "options"].includes(key),
        )
      )
        throw new Error("Invalid manifest service source");
    }
  }
  return value as unknown as PluginManifest;
}
export async function loadPluginManifest(
  path: string,
): Promise<RuntimePlugin[]> {
  const absolute = resolve(path),
    manifest = await readPluginManifest(absolute),
    loaded: RuntimePlugin[] = [];
  for (const specifier of manifest.plugins) {
    if (
      specifier.startsWith("node:") ||
      (/^[a-z]+:/i.test(specifier) && !isAbsolute(specifier))
    )
      throw new Error(
        "Plugin manifest supports local files or installed modules only",
      );
    const target =
      isAbsolute(specifier) || specifier.startsWith(".")
        ? pathToFileURL(resolve(dirname(absolute), specifier)).href
        : resolveModule(specifier, pathToFileURL(absolute).href);
    loaded.push((await import(target)).default as RuntimePlugin);
  }
  createRegistry(loaded);
  return loaded;
}
