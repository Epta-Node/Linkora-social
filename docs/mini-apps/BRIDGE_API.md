# Mini app bridge API

Mini apps run as untrusted web content. The host injects a bridge only after
validating the app manifest. A method is available only when its permission is
declared, and signing or posting always requires a fresh user approval.

The examples below use the public bridge shape returned by
`apps/mobile/mini-apps/bridge.ts`.

## Methods and permissions

| Method                        | Permission             | Result                                |
| ----------------------------- | ---------------------- | ------------------------------------- |
| `wallet.getAddress()`         | none                   | Connected public Stellar address      |
| `wallet.signTransaction(xdr)` | `wallet.sign`          | Signed XDR, or `UserRejectedError`    |
| `post.create(content)`        | `post.create`          | New post ID, or `null` when cancelled |
| `social.getFollowers({ address })` | `social.getFollowers` | Array of follower addresses |
| `social.getFollowing({ address })` | `social.getFollowing` | Array of followed addresses |

The older message-oriented host adapter exposes the same capabilities as
`wallet.getAddress`, `wallet.sign`, `profile.get`, `profile.update`, and
`post.create`. It additionally requires `profile.read` for `profile.get` and
redacts secret-shaped fields from every response. Follow-graph methods use
`social.getFollowers` / `social.getFollowing` and require their matching permissions.

## JavaScript

```js
const address = await linkora.wallet.getAddress();

try {
  const signedXdr = await linkora.wallet.signTransaction(unsignedXdr);
  await submitToStellar(signedXdr);
} catch (error) {
  if (error?.code === "USER_REJECTED") {
    showMessage("The transaction was cancelled.");
  } else {
    showMessage("Signing failed; nothing was submitted.");
  }
}

const postId = await linkora.post.create("Hello from my mini app");
if (postId === null) showMessage("Post cancelled");
```

## TypeScript

```ts
declare const linkora: {
  wallet: {
    getAddress(): string;
    signTransaction(xdr: string): Promise<string>;
  };
  post: { create(content: string): Promise<number | null> };
};

const xdr = buildUnsignedTransaction(linkora.wallet.getAddress());
const signed = await linkora.wallet.signTransaction(xdr);
const postId = await linkora.post.create("A verified Linkora update");
```

For a native host written in Swift or Kotlin, expose these same operations to
the WebView as a promise-backed JavaScript object. Keep the native handler
behind the confirmation sheet; never inject a private key, bearer token, or
unsigned-transaction result under the name `signedXdr`. The exact WebView
injection mechanism is platform-specific, but the permission and approval
rules are not.

## Follow graph

`social.getFollowers` and `social.getFollowing` read follow data from the Linkora SDK/indexer.

- Params: `{ address: string }`
- Returns: `Promise<string[]>`
- Empty graph: returns `[]`
- Network/HTTP failure: rejects with `BridgeError` code `MethodUnavailable` and a descriptive message

```js
const followers = await linkora.call("social.getFollowers", { address });
const following = await linkora.call("social.getFollowing", { address });
console.log(followers, following);
```

```ts
const followers: string[] = await linkora.call("social.getFollowers", { address });
const following: string[] = await linkora.call("social.getFollowing", { address });
```

## Error handling

The message-oriented adapter returns a `BridgeError` with one of these codes:

- `PermissionDenied`: the manifest did not declare the requested permission.
- `UserRejected`: the user dismissed the approval prompt.
- `MethodUnavailable`: the host did not register a handler.

Treat all three as expected user-visible failures. Never retry a rejected
signature automatically, and never broadcast an XDR unless the wallet returned
it from a successful signing call.

## Common patterns

### Signing

1. Build the unsigned transaction from the connected public address.
2. Show the transaction summary in the mini app.
3. Call `wallet.signTransaction` once.
4. Submit only the returned signed XDR and show the network result.

### Posting

Call `post.create` with the proposed text. The host confirmation sheet may edit
the content, so use the returned post ID and final host result rather than
assuming the original text was submitted.

### Tipping

The current bridge does not expose a `tip` method. A mini app must not treat
`wallet.signTransaction` as a generic silent payment API: construct a reviewed
transaction, request the `wallet.sign` permission, and let the host show the
asset, amount, recipient, and fee before signing.

### Security checklist

- Declare the smallest manifest permission set.
- Request approval for every consequential call.
- Never place secrets in bridge payloads or response objects.
- Handle cancellation and network failure separately from success.
- Keep the mini app origin fixed after the host loads it.
