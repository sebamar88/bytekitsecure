#!/usr/bin/env node
import {
  serveOutputBridge,
  runNativeProcess,
  type Selection,
} from "@causign/runtime";
import { buildClaudeLaunch } from "./launch.js";
import { probeClaude } from "./probe.js";
import { translateClaudeResult } from "./translate.js";
try {
  const selection = JSON.parse(process.argv[2] ?? "null") as Selection;
  if (!selection?.target) throw new Error("Missing Claude selection");
  const probe = await probeClaude(selection.target);
  if (!probe.capabilities.includes("observe.output"))
    throw new Error(probe.diagnostics.map((item) => item.message).join("; "));
  await serveOutputBridge({
    name: "causign-claude-code",
    version: "0.1.1",
    async execute(input, context) {
      const launch = await buildClaudeLaunch(
        selection,
        typeof input === "string" ? input : JSON.stringify(input),
      );
      return translateClaudeResult(
        await runNativeProcess(launch, {
          signal: context.signal,
          timeoutMs: context.timeoutMs,
          maxOutputBytes: 8388608,
        }),
      );
    },
  });
} catch (error) {
  process.stderr.write(
    `ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
