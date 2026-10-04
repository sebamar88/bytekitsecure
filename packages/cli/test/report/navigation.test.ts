import { it, expect } from "vitest";
import { findEvidencePage } from "../../src/report/web/navigation.js";
import { details } from "./fixtures.js";
it("locates an event on a later page without assuming contiguous receive sequences", async () => {
  const d = details();
  d.trace.events[0].receiveSequence = 301;
  const initial = { trace: { events: [] }, timeline: { totalPages: 2 } };
  const found = await findEvidencePage(
    "m",
    0,
    initial,
    async () => ({ trace: d.trace, timeline: { totalPages: 2 } }),
    () => true,
  );
  expect(found).toBe(1);
});
it("discards a delayed evidence lookup after the selection changes", async () => {
  let current = true;
  let complete!: (value: any) => void;
  const pending = new Promise<any>((resolve) => {
    complete = resolve;
  });
  const lookup = findEvidencePage(
    "m",
    0,
    { trace: { events: [] }, timeline: { totalPages: 2 } },
    async () => pending,
    () => current,
  );
  current = false;
  complete({ trace: details().trace, timeline: { totalPages: 2 } });
  expect(await lookup).toBeNull();
});
it("reports unavailable evidence instead of navigating to another event", async () => {
  expect(
    await findEvidencePage(
      "missing",
      0,
      { trace: details().trace, timeline: { totalPages: 1 } },
      async () => {
        throw new Error("unneeded");
      },
      () => true,
    ),
  ).toBeNull();
});
it("focuses evidence without an automatic scroll and only scrolls when outside the viewport", async () => {
  const { focusEvidence } = await import("../../src/report/web/navigation.js");
  const calls: string[] = [];
  let outside = false;
  const target = {
    tabIndex: 0,
    focus: (options: FocusOptions) => {
      expect(options.preventScroll).toBe(true);
      calls.push("focus");
    },
    scrollIntoView: (options: ScrollIntoViewOptions) => {
      expect(options.block).toBe("nearest");
      calls.push("scroll");
    },
    getBoundingClientRect: () => ({
      top: outside ? 900 : 100,
      bottom: outside ? 1000 : 200,
    }),
  };
  focusEvidence(target, 800, false);
  expect(calls).toEqual(["focus"]);
  outside = true;
  focusEvidence(target, 800, true);
  expect(calls).toEqual(["focus", "focus", "scroll"]);
});
