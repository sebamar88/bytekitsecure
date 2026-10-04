import { it, expect } from "vitest";
import { startReportServer } from "../../dist/report/server.js";
import { root, execution } from "./fixtures.js";
it("serves the report navigation shell and real bundled browser assets", async () => {
  const path = await root();
  await execution(path);
  const h = await startReportServer({ root: path });
  try {
    const base = new URL(h.url).origin;
    const html = await (await fetch(base)).text();
    for (const id of [
      "history",
      "status-filter",
      "scenario-list",
      "scenario-detail",
      "timeline",
    ])
      expect(html).toContain(`id="${id}"`);
    const js = await fetch(`${base}/client.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    const css = await fetch(`${base}/style.css`);
    expect(css.headers.get("content-type")).toContain("text/css");
  } finally {
    await h.close();
  }
});
