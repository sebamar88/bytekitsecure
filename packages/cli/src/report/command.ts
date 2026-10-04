import { resolve } from "node:path";
import type { CliIO } from "../main.js";
import { startReportServer, type ReportServerOptions } from "./server.js";
import { openBrowser } from "./open-browser.js";
export interface ViewerServices {
  openBrowser?: typeof openBrowser;
}
export async function viewReport(
  options: ReportServerOptions,
  io: CliIO,
  services: ViewerServices = {},
  noOpen = false,
): Promise<void> {
  const server = await startReportServer({ ...options, signal: io.signal });
  try {
    io.stdout(
      "Report viewer stays in this terminal. Press Ctrl+C to close it.",
    );
    io.stdout(`Local report: ${server.url}`);
    if (!noOpen && !io.signal?.aborted)
      try {
        await (services.openBrowser ?? openBrowser)(server.url);
      } catch (error) {
        io.stderr(
          `Browser unavailable: ${error instanceof Error ? error.message : String(error)}. Open the printed URL.`,
        );
      }
    await server.closed;
  } finally {
    await server.close();
  }
}
export async function reportCommand(
  args: string[],
  io: CliIO,
  services: ViewerServices = {},
): Promise<number> {
  let output = ".causign/results",
    port: number | undefined,
    noOpen = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--no-open") {
      noOpen = true;
      continue;
    }
    if (arg === "--output-dir" || arg === "--port") {
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${arg}`);
      if (arg === "--output-dir") output = value;
      else {
        if (!/^[1-9]\d*$/.test(value) || Number(value) > 65535)
          throw new Error("Invalid port: use 1 through 65535.");
        port = Number(value);
      }
      continue;
    }
    throw new Error(`Unknown report option ${arg}`);
  }
  await viewReport(
    { root: resolve(io.cwd ?? process.cwd(), output), port },
    io,
    services,
    noOpen,
  );
  return 0;
}
