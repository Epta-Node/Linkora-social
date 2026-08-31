/**
 * Jest configuration for E2E integration tests.
 *
 * These tests require a running Docker Compose environment
 * (Stellar standalone network + indexer + DM relay).
 * Run via: bash tests/integration/run_e2e.sh
 *
 * @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  displayName: "e2e-integration",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/integration"],
  testMatch: ["**/e2e-*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  // Source files use ESM-style ".js" specifiers for relative imports
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Map @linkora/sdk to its source for direct import in tests
    "^@linkora/sdk$": "<rootDir>/packages/sdk/src/index.ts",
    "^@linkora/sdk/(.*)$": "<rootDir>/packages/sdk/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          target: "ES2022",
          module: "commonjs",
          moduleResolution: "node",
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          declaration: false,
        },
        diagnostics: {
          warnOnly: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ["/node_modules/(?!(.*\\.mjs$|@stellar|@noble))"],
  testTimeout: 300_000, // 5 minutes per test
  testFailureExitCode: 1,
  verbose: true,
  maxWorkers: 1,
};
