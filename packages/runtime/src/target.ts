import { isAbsolute } from "node:path";
import type { ExecutionTarget } from "./types.js";
import type { NativeLaunch } from "./process.js";
export function targetLaunch(
  target: ExecutionTarget,
  defaultCommand: string,
  args: string[],
  stdin?: string,
): NativeLaunch {
  if (target.args?.some((arg) => typeof arg !== "string"))
    throw new Error("Target args must be literal strings");
  if (target.kind === "native") {
    if (!isAbsolute(target.cwd)) throw new Error("Native cwd must be absolute");
    return {
      command: target.command ?? defaultCommand,
      args: [...(target.args ?? []), ...args],
      cwd: target.cwd,
      ...(stdin !== undefined ? { stdin } : {}),
    };
  }
  if (
    !target.distro ||
    target.distro.startsWith("-") ||
    !target.cwd.startsWith("/") ||
    target.cwd.includes("\\") ||
    target.cwd.includes("\0")
  )
    throw new Error("WSL requires explicit distro and absolute POSIX cwd");
  if (process.platform !== "win32")
    throw new Error("WSL target requires Windows host");
  return {
    command: "wsl.exe",
    args: [
      "--distribution",
      target.distro,
      "--cd",
      target.cwd,
      "--exec",
      target.command ?? defaultCommand,
      ...(target.args ?? []),
      ...args,
    ],
    ...(stdin !== undefined ? { stdin } : {}),
  };
}
