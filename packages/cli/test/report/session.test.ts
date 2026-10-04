import { it, expect } from "vitest";
import { reportSessionToken } from "../../src/report/web/session.js";
const token = "a".repeat(64);
it("accepts a valid session fragment and retains a saved token for navigation anchors", () => {
  expect(reportSessionToken(`#${token}`, null)).toBe(token);
  expect(reportSessionToken("#scenario-detail", token)).toBe(token);
  expect(reportSessionToken("", token)).toBe(token);
  expect(reportSessionToken("#not-a-token", null)).toBe("");
});
it("rejects invalid saved credentials and accepts a new valid token over a stale session", () => {
  expect(reportSessionToken("", "#scenario-detail")).toBe("");
  expect(reportSessionToken(`#${"b".repeat(64)}`, token)).toBe("b".repeat(64));
});
