import { it, expect } from "vitest";
import { details } from "./fixtures.js";
import { explainAssertion } from "../../src/report/explain.js";
it("shows nested JSON differences with escaped paths", () => {
  const d = details();
  d.plan.assertions[0].parameters = {
    value: { "a/b": { "~key": null }, items: [1, 2], missing: true },
  };
  d.trace.events[0].message.payload = {
    output: { "a/b": { "~key": false }, items: [1, 3], extra: true },
  };
  expect(explainAssertion(d, 0).differences).toEqual(
    expect.arrayContaining([
      { path: "/a~1b/~0key", kind: "changed", expected: null, observed: false },
      { path: "/items/1", kind: "changed", expected: 2, observed: 3 },
      { path: "/missing", kind: "missing", expected: true },
      { path: "/extra", kind: "unexpected", observed: true },
    ]),
  );
});
it("object key order is irrelevant and negated failure explains forbidden equality", () => {
  const d = details();
  d.plan.assertions[0].parameters = { value: { a: 1, b: 2 } };
  d.trace.events[0].message.payload = { output: { b: 2, a: 1 } };
  d.plan.assertions[0].negated = true;
  const e = explainAssertion(d, 0);
  expect(e.differences).toEqual([]);
  expect(e.guidance).toMatch(/prohibited|forbidden/i);
});
it("bounds differences at 1000 paths and handles deep JSON without stack overflow", () => {
  const d = details();
  d.plan.assertions[0].parameters = {
    value: Array.from({ length: 1001 }, () => 0),
  };
  d.trace.events[0].message.payload = {
    output: Array.from({ length: 1001 }, () => 1),
  };
  expect(explainAssertion(d, 0)).toMatchObject({
    truncated: true,
    differences: expect.any(Array),
  });
  expect(explainAssertion(d, 0).differences).toHaveLength(1000);
  let a: any = 0,
    b: any = 1;
  for (let i = 0; i < 3000; i++) {
    a = { v: a };
    b = { v: b };
  }
  d.plan.assertions[0].parameters = { value: a };
  d.trace.events[0].message.payload = { output: b };
  expect(explainAssertion(d, 0).differences).toHaveLength(1);
});
it("does not parse formatted expected strings or synthesize absent evidence", () => {
  const d = details();
  const e = explainAssertion({ result: d.result, warnings: [] }, 0);
  expect(e.expected).toBe(d.result.assertions[0].expected);
  expect(e.differences).toEqual([]);
  expect(e.evidence[0].available).toBe(false);
});
it("never describes a request as execution and respects incomplete evidence", () => {
  const d = details();
  d.plan.assertions[0] = {
    id: "greeting",
    type: "tool.executed",
    parameters: { name: "delete" },
    negated: true,
    requirements: [],
  };
  d.trace.completeness = "incomplete";
  d.result.assertions[0].status = "NOT_EVALUATED";
  d.trace.events = [];
  const e = explainAssertion(d, 0);
  expect(e.guidance).toMatch(/incomplete|insufficient/i);
  expect(e.reason).toBe(d.result.assertions[0].reason);
});
it.each(["ERROR", "INCOMPATIBLE", "SKIP"] as const)(
  "retains %s semantics",
  (status) => {
    const d = details();
    d.result.status = status;
    d.result.missingCapabilities = ["observe.output"];
    const e = explainAssertion(d, 0);
    expect(e.reason).toBe(d.result.assertions[0].reason);
    expect(e.guidance).toMatch(
      status === "ERROR"
        ? /diagnostic/i
        : status === "INCOMPATIBLE"
          ? /capabilit/i
          : /skip/i,
    );
  },
);
it("preserves metric and evaluator provenance and navigable message evidence", () => {
  const d = details();
  d.result.assertions[0].evidence.push(
    { kind: "metric", metric: "cost", value: 2, currency: "USD" },
    { kind: "evaluator", evaluatorId: "judge", configHash: "h", model: "m" },
  );
  const e = explainAssertion(d, 0);
  expect(e.evidence[0]).toMatchObject({ available: true, sequence: 1 });
  expect(e.evidence[1].reference).toMatchObject({ value: 2 });
  expect(e.evidence[2].reference).toMatchObject({ configHash: "h" });
});
