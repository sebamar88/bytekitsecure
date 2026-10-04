import { spawn } from "node:child_process";
export interface NativeLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}
export interface NativeResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}
export async function runNativeProcess(
  launch: NativeLaunch,
  options: { signal: AbortSignal; maxOutputBytes: number; timeoutMs: number },
): Promise<NativeResult> {
  for (const value of [options.maxOutputBytes, options.timeoutMs])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Native limits must be positive integers");
  if (options.signal.aborted) throw new Error("Native execution cancelled");
  const child = spawn(launch.command, launch.args, {
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    cwd: launch.cwd,
    env: launch.env ? { ...process.env, ...launch.env } : process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout: Buffer[] = [];
  let stderr: Buffer[] = [];
  let bytes = 0;
  let failure: Error | undefined;
  let cleanup: Promise<void> | undefined;
  const kill = () => {
    if (cleanup) return;
    cleanup = new Promise<void>((resolve) => {
      if (!child.pid) {
        resolve();
        return;
      }
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill.exe",
          ["/pid", String(child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore" },
        );
        const fallback = setTimeout(() => {
          child.kill("SIGKILL");
          killer.kill();
          resolve();
        }, 500);
        killer.once("error", () => {
          child.kill("SIGKILL");
          clearTimeout(fallback);
          resolve();
        });
        killer.once("close", (code) => {
          if (code !== 0) child.kill("SIGKILL");
          clearTimeout(fallback);
          resolve();
        });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill();
        }
        // Direct-child closure does not cancel escalation for surviving descendants.
        setTimeout(() => {
          try {
            process.kill(-child.pid!, "SIGKILL");
          } catch {
            /* Group already stopped. */
          }
          resolve();
        }, 250);
      }
    });
  };
  const fail = (error: Error) => {
    failure ??= error;
    kill();
  };
  const abort = () => fail(new Error("Native execution cancelled"));
  options.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => fail(new Error("Native execution timeout")),
    options.timeoutMs,
  );
  const capture = (target: Buffer[], chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > options.maxOutputBytes) {
      fail(new Error("Native output byte limit exceeded"));
      return;
    }
    if (!failure) target.push(chunk);
  };
  child.stdout.on("data", (chunk: Buffer) => capture(stdout, chunk));
  child.stderr.on("data", (chunk: Buffer) => capture(stderr, chunk));
  child.stdin.on("error", () => {});
  child.stdin.end(launch.stdin ?? "");
  try {
    return await new Promise<NativeResult>((resolve, reject) => {
      child.once("error", (error) => {
        failure ??= error;
      });
      child.once("close", (exitCode, signal) => {
        if (failure) reject(failure);
        else
          resolve({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            exitCode,
            signal,
          });
        stdout = [];
        stderr = [];
      });
    });
  } finally {
    clearTimeout(timer);
    options.signal.removeEventListener("abort", abort);
    await cleanup;
  }
}
