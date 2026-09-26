// #1559 — fail the build/start fast with an actionable error naming the
// missing variable, instead of the app silently falling back to
// http://localhost:3001 at runtime. Also mirrors the validated URL into
// `extra` so it's visible in the resolved config (`expo config`).
//
// ponytail: duplicates the validation in utils/indexerConfig.ts rather than
// importing it, because this file runs directly under Node via the Expo CLI
// (no TS/babel transform applied to required modules). Keep both in sync if
// the rule ever changes.
function resolveIndexerUrl() {
  const raw = process.env.EXPO_PUBLIC_INDEXER_URL;
  if (!raw) {
    throw new Error(
      "EXPO_PUBLIC_INDEXER_URL is not set. Configure it in your environment or EAS build profile " +
        "(see apps/mobile/README.md)."
    );
  }

  const allowInsecureLocal = process.env.EXPO_PUBLIC_LOCAL_DEV === "1";
  if (!raw.startsWith("https://") && !(allowInsecureLocal && raw.startsWith("http://"))) {
    throw new Error(
      `EXPO_PUBLIC_INDEXER_URL must use https:// (got "${raw}"). ` +
        "Set EXPO_PUBLIC_LOCAL_DEV=1 to allow http:// for local development only."
    );
  }

  return raw.replace(/\/$/, "");
}

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    indexerUrl: resolveIndexerUrl(),
  },
});
