import type { RuntimePlugin, Registry, AgentCandidate } from "./types.js";
const namespaced = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]+$/.test(value);
export function createRegistry(plugins: RuntimePlugin[]): Registry {
  const ids = new Set<string>();
  const register = (id: unknown, label: string) => {
    if (!namespaced(id)) throw new Error(`Invalid ${label} ID`);
    if (ids.has(id)) throw new Error(`Duplicate registry ID: ${id}`);
    ids.add(id);
  };
  for (const plugin of plugins) {
    if (!plugin || plugin.apiVersion !== "1")
      throw new Error("Unsupported plugin API version");
    register(plugin.id, "plugin");
    if (!Array.isArray(plugin.discoverers) || !Array.isArray(plugin.adapters))
      throw new Error("Invalid plugin collections");
    for (const discoverer of plugin.discoverers) {
      register(discoverer?.id, "discoverer");
      if (
        typeof discoverer.discover !== "function" ||
        !Array.isArray(discoverer.sourceKinds) ||
        !discoverer.sourceKinds.length ||
        discoverer.sourceKinds.some(
          (kind) => kind !== "file" && kind !== "service",
        )
      )
        throw new Error("Invalid discoverer contract");
    }
    for (const adapter of plugin.adapters) {
      register(adapter?.id, "adapter");
      if (
        ["supports", "probe", "createLaunch"].some(
          (key) =>
            typeof (adapter as unknown as Record<string, unknown>)[key] !==
            "function",
        )
      )
        throw new Error("Invalid adapter contract");
    }
  }
  const saved = Object.freeze(
    plugins.map((plugin) =>
      Object.freeze({
        ...plugin,
        discoverers: Object.freeze([
          ...plugin.discoverers,
        ]) as unknown as RuntimePlugin["discoverers"],
        adapters: Object.freeze([
          ...plugin.adapters,
        ]) as unknown as RuntimePlugin["adapters"],
      }),
    ),
  );
  const discoverers = Object.freeze(
      saved.flatMap((plugin) => plugin.discoverers),
    ),
    adapters = Object.freeze(saved.flatMap((plugin) => plugin.adapters));
  return Object.freeze({
    plugins: saved,
    discoverers,
    adapters,
    match: (candidate: AgentCandidate) =>
      adapters
        .filter((adapter) => adapter.supports(candidate))
        .map((adapter) => adapter.id)
        .sort(),
  });
}
