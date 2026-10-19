# Linkora Mobile

## Required environment variables

| Variable                  | Required | Notes                                                                                                                          |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_INDEXER_URL` | Yes      | Base URL of the indexer API. Must be `https://`.                                                                               |
| `EXPO_PUBLIC_LOCAL_DEV`   | No       | Set to `1` to allow an `http://` `EXPO_PUBLIC_INDEXER_URL` for local development only. Never set this in a real build profile. |

There is no default/fallback indexer URL. Starting the app or building without
`EXPO_PUBLIC_INDEXER_URL` set fails fast with an error naming the missing
variable, rather than silently trying `http://localhost:3001` (which only
happens to work on a simulator and never on a real device). The resolved
value is exposed as `extra.indexerUrl` in the app's resolved config (see
`app.config.js`), so `expo config` shows what a build actually resolved to.
