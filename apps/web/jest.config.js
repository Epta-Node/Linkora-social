module.exports = {
  displayName: "apps-web",
  preset: "ts-jest",
  testEnvironment: "jsdom",
  roots: ["<rootDir>"],
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)", "**/*.test.(ts|tsx)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^linkora-sdk$": "<rootDir>/../../packages/sdk/src/index.ts",
    "^@linkora/types/src/(.*)$": "<rootDir>/../../packages/types/src/$1",
    "^@linkora/types$": "<rootDir>/../../packages/types/src/index.ts",
    // linkora-sdk's source uses ESM-style ".js" relative imports that
    // resolve to sibling ".ts" files at build time; strip the extension so
    // Jest's resolver falls through to moduleFileExtensions.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/*.stories.tsx",
    "!src/**/index.ts",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/.next/", "/out/"],
};
