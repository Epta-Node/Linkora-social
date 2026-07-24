module.exports = {
  preset: "jest-expo",
  transformIgnorePatterns: [
    "node_modules/(?!.pnpm/|(?:.pnpm/[^/]+/node_modules/)?(jest-)?react-native|(?:.pnpm/[^/]+/node_modules/)?@react-native(-community)?/|(?:.pnpm/[^/]+/node_modules/)?@react-native[/+]js-polyfills|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native)",
  ],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^expo-router$": "<rootDir>/jest.expo-router-mock.js",
    "^@stellar/wallet-kit$": "<rootDir>/jest.wallet-kit-mock.js",
  },
  collectCoverage: true,
  coverageReporters: ["json", "lcov", "text", "clover"],
};
