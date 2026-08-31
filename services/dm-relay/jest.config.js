module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transformIgnorePatterns: ["/node_modules/(?!(uuid|@noble/hashes|@noble/curves|@noble/ed25519)/)"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    "^.+\\.js$": ["ts-jest", { useESM: false }],
  },
};
