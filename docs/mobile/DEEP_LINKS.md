# Mobile deep links and push notifications

## Deep link schemes

The mobile app supports these entry points:

- `linkora://post/:id`
- `linkora://profile/:address`
- `linkora://pool/:id`
- `linkora://dm/:address`
- `https://linkora.social/:resource/:id` for universal links

Routes resolve to the app screens:

- Post detail: `/post/:id`
- Profile detail: `/profile/:address`
- Pool detail: `/pools/:id`
- Direct messages: `/dm/:address`

## Universal link setup

1. Configure the app bundle and associated domains in the Expo config.
2. Publish an Apple App Site Association file from `https://linkora.social/.well-known/apple-app-site-association`.
3. Replace `TEAMID` in `packages/web/public/.well-known/apple-app-site-association` with the Apple Developer Team ID for the production iOS app.
4. Ensure the `appID` is formatted as `TEAMID.social.linkora.app` and contains path patterns for `/post/*`, `/profile/*`, `/pool/*`, and `/dm/*`.

Example structure:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["TEAMID.social.linkora.app"],
        "components": [
          { "/": "/post/*" },
          { "/": "/profile/*" },
          { "/": "/pool/*" },
          { "/": "/dm/*" }
        ]
      }
    ]
  }
}
```

## Testing

- Run the app and open `linkora://post/42` from a simulator or device.
- Test a universal link by opening `https://linkora.social/post/42` in a browser or via the simulator.
- Verify unknown IDs show a not-found state instead of crashing.
- Trigger a sample notification payload and confirm tapping it opens the relevant screen.

## Push notification payloads

Notification `data` payloads should include a mobile notification `type` plus either a `deepLink` or the route identifier:

- Follow: `{ "type": "NEW_FOLLOWER", "followerAddress": "G...", "deepLink": "linkora://profile/G..." }`
- Tip: `{ "type": "TIP_RECEIVED", "postId": "42", "deepLink": "linkora://post/42" }`
- Like: `{ "type": "LIKE_RECEIVED", "postId": "42", "deepLink": "linkora://post/42" }`
