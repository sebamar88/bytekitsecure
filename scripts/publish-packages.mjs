import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export async function planPublication(packages, exists) {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const visited = new Set(),
    active = new Set(),
    ordered = [];
  function visit(pkg) {
    if (active.has(pkg.name))
      throw new Error(`Workspace dependency cycle: ${pkg.name}`);
    if (visited.has(pkg.name)) return;
    active.add(pkg.name);
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    }).sort())
      if (byName.has(name)) visit(byName.get(name));
    active.delete(pkg.name);
    visited.add(pkg.name);
    ordered.push(pkg);
  }
  for (const pkg of packages) visit(pkg);
  const pending = [];
  for (const pkg of ordered) if (!(await exists(pkg))) pending.push(pkg);
  return pending;
}

async function registryHas(pkg) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { "Cache-Control": "no-cache" },
  });
  if (response.status === 404) return false;
  if (!response.ok)
    throw new Error(
      `Registry check failed for ${pkg.name}: HTTP ${response.status}`,
    );
  const value = await response.json();
  if (value.name !== pkg.name || value.version !== pkg.version)
    throw new Error(`Invalid registry response for ${pkg.name}`);
  return true;
}

function command(executable, args, cwd) {
  const result = spawnSync(executable, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${executable} exited with ${result.status}`);
}

async function main() {
  const root = resolve("."),
    packages = [];
  for (const dir of (await readdir(join(root, "packages"))).sort()) {
    const directory = join(root, "packages", dir);
    const pkg = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    if (!pkg.private) packages.push({ ...pkg, directory });
  }
  const pending = await planPublication(packages, registryHas);
  console.log(
    pending.length
      ? `Pending: ${pending.map((p) => `${p.name}@${p.version}`).join(", ")}`
      : "All package versions already published.",
  );
  if (process.argv.includes("--dry-run") || !pending.length) return;
  if (process.platform === "win32")
    throw new Error(
      "Publishing script requires the Linux release runner; use --dry-run locally.",
    );
  if (!process.env.NODE_AUTH_TOKEN)
    throw new Error("NPM_TOKEN is required for publishing.");
  const archiveRoot = await mkdtemp(join(tmpdir(), "causign-publish-"));
  try {
    for (const pkg of pending) {
      const destination = join(archiveRoot, pkg.name.replaceAll("/", "-"));
      await (await import("node:fs/promises")).mkdir(destination);
      command(
        "pnpm",
        ["pack", "--pack-destination", destination],
        pkg.directory,
      );
      const archives = (await readdir(destination)).filter((name) =>
        name.endsWith(".tgz"),
      );
      if (archives.length !== 1)
        throw new Error(`Expected one archive for ${pkg.name}`);
      command(
        "npm",
        [
          "publish",
          join(destination, archives[0]),
          "--access",
          "public",
          "--tag",
          "latest",
        ],
        root,
      );
    }
  } finally {
    await rm(archiveRoot, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
