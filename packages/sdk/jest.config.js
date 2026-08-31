module.exports = {
  displayName: "sdk",
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  // Source files use ESM-style ".js" specifiers for relative imports (e.g.
  // `from "./generated/client.js"`) even though only the ".ts" source
  // exists; ts-jest compiles to commonjs, so map those back to extensionless
  // specifiers for Node's resolver to find the compiled .ts module.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
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
