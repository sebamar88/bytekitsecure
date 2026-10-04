import { it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { openBrowser } from "../../src/report/open-browser.js";
it.each([
  ["win32", "rundll32.exe"],
  ["darwin", "open"],
  ["linux", "xdg-open"],
])("launches %s using literal arguments", async (platform, command) => {
  let captured: any;
  const url = "http://127.0.0.1:1234/#abc";
  await openBrowser(url, platform, (file, args, options) => {
    captured = { file, args, options };
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child as never;
  });
  expect(captured.file).toBe(command);
  expect(captured.args).toContain(url);
  expect(captured.options.shell).toBe(false);
  expect(captured.options.windowsHide).toBe(true);
});
it("surfaces browser launcher failure", async () => {
  await expect(
    openBrowser("http://127.0.0.1:1234/", "linux", () => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("error", new Error("no browser")));
      return child as never;
    }),
  ).rejects.toThrow("no browser");
});
