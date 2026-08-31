module.exports = {
  displayName: "sdk-e2e",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/e2e.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          target: "ES2020",
          module: "commonjs",
          strict: true,
        },
      },
    ],
  },
  testTimeout: 60000,
};
