import { it, expect } from "vitest";
import { encodeReportJson } from "../../src/report/response.js";
it("encodes plain report data consistently with JSON", () => {
  const value = {
    message: 'Unicode 🧪 and "quoted"',
    array: [null, true, undefined],
    optional: undefined,
    nested: { a: 2 },
  };
  expect(JSON.parse(encodeReportJson(value))).toEqual({
    message: 'Unicode 🧪 and "quoted"',
    array: [null, true, null],
    nested: { a: 2 },
  });
});
it("stops at an aggregate UTF-8 byte budget for repeated object references", () => {
  const value = { text: "😀".repeat(50) };
  expect(() => encodeReportJson([value, value, value], 500)).toThrow(/limit/i);
  expect(Buffer.byteLength(encodeReportJson(value, 500))).toBeLessThan(500);
});
it("uses iterative traversal for deeply nested JSON", () => {
  let value: any = 1;
  for (let i = 0; i < 5000; i++) value = { v: value };
  expect(encodeReportJson(value).length).toBe(30001);
});
