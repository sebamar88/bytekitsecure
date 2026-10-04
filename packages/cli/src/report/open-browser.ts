import { spawn } from "node:child_process";
export async function openBrowser(
  url: string,
  platform: string = process.platform,
  launch: typeof spawn = spawn,
): Promise<void> {
  const command =
    platform === "win32"
      ? "rundll32.exe"
      : platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = launch(command, args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Browser launcher timed out; use the printed URL."));
    }, 5000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else
        reject(new Error("Browser could not be opened; use the printed URL."));
    });
  });
}
