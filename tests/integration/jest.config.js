/** @type {import('jest').Config} */
module.exports = {
  displayName: "e2e-integration",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>"],
  testMatch: ["**/e2e-*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          target: "ES2022",
          module: "commonjs",
          strict: true,
          skipLibCheck: true,
        },
      },
    ],
  },
  testTimeout: 120_000,
  reporters: [
    "default",
  ],
};
