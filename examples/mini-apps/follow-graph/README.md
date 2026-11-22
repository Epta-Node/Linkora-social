# Follow Graph Mini App

Demonstrates `social.getFollowers` and `social.getFollowing` from the Linkora bridge.

## Permissions

- `wallet.getAddress`
- `social.getFollowers`
- `social.getFollowing`

## Local setup

1. Open `index.html` in the Linkora mini-app host, or serve this directory with a static server.
2. Ensure the host exposes `window.LinkoraSDK.call`.
3. Click **Load follow graph**.

The app shows `[]` when the account has no connections and displays a descriptive error on network failure.
