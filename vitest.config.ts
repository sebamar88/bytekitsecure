import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "tests/acceptance/**/*.test.ts",
      "scripts/*.test.mjs",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/protocol/src/generated.ts"],
      reporter: ["text", "html", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
