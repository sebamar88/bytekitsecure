export function createEvaluator() {
  return {
    async evaluate(output) {
      const pass =
        Array.isArray(output?.citations) && output.citations.length > 0;
      return {
        status: pass ? "PASS" : "FAIL",
        explanation: pass
          ? "Fixture contains citation IDs"
          : "Fixture has no citation IDs",
      };
    },
  };
}
