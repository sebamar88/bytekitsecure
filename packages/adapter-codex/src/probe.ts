import {
  runNativeProcess,
  targetLaunch,
  type ExecutionTarget,
  type RuntimeProbe,
} from "@causign/runtime";
export async function probeCodex(
  target: ExecutionTarget,
): Promise<RuntimeProbe> {
  try {
    const result = await runNativeProcess(
      targetLaunch(target, "codex", ["--version"]),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 65536,
        timeoutMs: 5000,
      },
    );
    if (result.exitCode !== 0) throw new Error("Codex version probe failed");
    const version = result.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
    return {
      available: true,
      version,
      capabilities: [],
      diagnostics: [
        {
          code:
            version === "0.159.0"
              ? "codex.profile-unsupported"
              : "runtime.version",
          severity: "error",
          message:
            version === "0.159.0"
              ? "Codex output profile unavailable: a global tool-denial boundary has not been verified. Read-only sandbox does not disable tools."
              : `Unsupported Codex version: ${version ?? "unknown"}; reference is 0.159.0`,
        },
      ],
    };
  } catch (error) {
    return {
      available: false,
      capabilities: [],
      diagnostics: [
        {
          code: "runtime.unavailable",
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
