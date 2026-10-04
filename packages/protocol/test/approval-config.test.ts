import { it, expect } from "vitest";
import { validateScenario } from "../src/index.js";
import { scenario } from "./fixtures.js";
it("accepts configured approval rules while validating their decisions", () => {
  expect(
    validateScenario(
      scenario({
        approvalDecisions: [
          { decision: "grant", input: null },
          { decision: "reject" },
        ],
      }),
    ).approvalDecisions,
  ).toHaveLength(2);
  expect(() =>
    validateScenario(scenario({ approvalDecisions: [{ decision: "maybe" }] })),
  ).toThrow();
});
