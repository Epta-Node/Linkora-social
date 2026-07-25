module.exports = {
  displayName: "sdk",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
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
  testPathIgnorePatterns: ["/node_modules/", "e2e.test.ts"],
};
