import {
  runNativeProcess,
  targetLaunch,
  type ExecutionTarget,
  type RuntimeProbe,
} from "@causign/runtime";
export async function probeClaude(
  target: ExecutionTarget,
): Promise<RuntimeProbe> {
  try {
    const result = await runNativeProcess(
      targetLaunch(target, "claude", ["--version"]),
      {
        signal: new AbortController().signal,
        maxOutputBytes: 65536,
        timeoutMs: 5000,
      },
    );
    const version = result.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
    if (result.exitCode !== 0) throw new Error("Claude version probe failed");
    return {
      available: true,
      version,
      capabilities: version === "2.1.284" ? ["observe.output"] : [],
      diagnostics:
        version === "2.1.284"
          ? [
              {
                code: "claude.policy",
                severity: "warning",
                message:
                  "Output profile disables tools, hooks and ordinary settings. Managed policy and native authentication remain in effect; discovery does not verify authentication.",
              },
            ]
          : [
              {
                code: "runtime.version",
                severity: "error",
                message: `Unsupported Claude version: ${version ?? "unknown"}; reference is 2.1.284`,
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
          message: error instanceof Error ? error.message : String(error),
          severity: "error",
        },
      ],
    };
  }
}
