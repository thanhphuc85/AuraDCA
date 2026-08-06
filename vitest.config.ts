import { defineConfig } from "vitest/config";

// Coverage acts as a ratchet in CI: thresholds sit just below the current
// numbers (stmts ~87 / branch ~74 / func ~84 / lines ~89), so a PR that drops
// test coverage on the already-tested modules fails, while ordinary changes
// pass. Only files the tests import are counted (all: false) — untested
// orchestration/UI (run.ts, api/, the dashboard) isn't dragged into the
// denominator, which would make the gate a wall instead of a ratchet.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      all: false,
      reporter: ["text-summary", "text"],
      exclude: [
        "src/__tests__/**",
        "src/**/*.test.ts",
        "src/types.ts",
        "**/*.config.*",
      ],
      thresholds: {
        statements: 85,
        branches: 72,
        functions: 82,
        lines: 87,
      },
    },
  },
});
