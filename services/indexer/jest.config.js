module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  // Transform ESM-only packages through ts-jest so CJS jest can handle them
  transformIgnorePatterns: ["/node_modules/(?!(uuid|@noble/hashes|@noble/curves|@noble/ed25519)/)"],
  transform: {
    "^.+\\.tsx?$": "ts-jest",
    // Bare JS files in ESM-only node_modules also need transforming
    "^.+\\.js$": ["ts-jest", { useESM: false }],
  },
};
