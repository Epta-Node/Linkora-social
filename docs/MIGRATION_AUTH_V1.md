# Migration Guide — Request-Bound Auth Signatures (`v1`)

**Audience:** anyone who calls a protected Linkora indexer endpoint with an
`Authorization: StellarSig …` header from their own code.

**Impact:** breaking. Credentials built the old way are rejected with `401 INVALID_SIGNATURE`
once the indexer is upgraded.

The full specification is in [CONTRACT_API.md](./CONTRACT_API.md). This guide covers only
what you have to change and how to tell whether you got it right.

---

## 1. What changed and why

The signed message used to be:

```
{address}:{timestamp}
```

That commits to nothing about the request. A credential captured from a read endpoint could
be replayed verbatim against any write endpoint inside the 30-second tolerance window, and
the server would execute it as the captured user. Rated CVSS 3.1 8.1 (High).

The signed message is now:

```
v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}
```

Same header, same transport, same timestamp rules, same keys. Only the bytes you sign
changed — the signature now binds the credential to one method, one path, and one body.

---

## 2. What you have to change

Three additions to how you build the message. Nothing else about your integration moves.

| Step | Change                                                                        |
| ---- | ----------------------------------------------------------------------------- |
| 1    | Compute `bodyHash` — lowercase hex SHA-256 of the exact body bytes you send.  |
| 2    | Canonicalise the request path — strip the query string and trailing slashes.  |
| 3    | Assemble the six-field message above instead of the two-field one, then hash. |

The rest is unchanged: you still SHA-256 the message, still Ed25519-sign that 32-byte
digest, still base64 the signature, still send
`StellarSig base64({address, timestamp, signature})`.

### Three things that will bite you

**Sign the absolute path, including the mount prefix.** It is
`/api/notifications/preferences`, not `/preferences`. The server canonicalises
`req.originalUrl`, which always carries the full path. If your HTTP client joins a base URL
with a relative path, make sure the signer sees the joined result — and keep the base URL an
origin with no path segment of its own, or that segment reaches the server without ever
reaching your signer.

**Hash the bytes you send, not the object you serialised.** Serialise once into a variable,
then feed that same variable to both the hash and the request body:

```ts
const body = JSON.stringify(payload); // once
const header = buildAuthHeader(keypair, { method: "POST", path, body });
await fetch(url, { method: "POST", body, headers: { Authorization: header } });
```

Calling `JSON.stringify(payload)` separately for the hash and for the request can produce
different bytes, and the signature would then commit to a body that was never sent. The
resulting `401` gives you no hint about the cause.

**No body means the hash of the empty string.** Every `GET`, and any request sent without a
body, uses:

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

---

## 3. Reference implementation

Self-contained — no Linkora packages required. Only `@stellar/stellar-sdk` for the keypair,
and Node's `crypto`. This exact code is verified against the running middleware.

```ts
import { createHash } from "crypto";
import { Keypair } from "@stellar/stellar-sdk";

function canonicalizeAuthPath(rawPath: string): string {
  const withoutQuery = rawPath.split("?")[0] ?? "";
  const withoutTrailingSlash = withoutQuery.replace(/\/+$/, "");
  return withoutTrailingSlash === "" ? "/" : withoutTrailingSlash;
}

function buildAuthMessage(parts: {
  method: string;
  canonicalPath: string;
  address: string;
  timestamp: number;
  bodyHash: string;
}): string {
  return [
    "v1",
    parts.method.toUpperCase(),
    parts.canonicalPath,
    parts.address,
    parts.timestamp,
    parts.bodyHash,
  ].join(":");
}

/**
 * Builds an Authorization header bound to one specific request.
 *
 * `path` is absolute from the indexer root, mount prefix included.
 * `body` is the exact string that will be sent, or undefined when there is none.
 */
export function buildAuthHeader(
  keypair: Keypair,
  req: { method: string; path: string; body?: string }
): string {
  const timestamp = Date.now();
  const bodyHash = createHash("sha256")
    .update(req.body ?? "", "utf8")
    .digest("hex");

  const message = buildAuthMessage({
    method: req.method,
    canonicalPath: canonicalizeAuthPath(req.path),
    address: keypair.publicKey(),
    timestamp,
    bodyHash,
  });

  const digest = createHash("sha256").update(message).digest();
  const signature = keypair.sign(digest).toString("base64");

  const payload = JSON.stringify({ address: keypair.publicKey(), timestamp, signature });
  return `StellarSig ${Buffer.from(payload).toString("base64")}`;
}
```

### In the browser

`crypto.subtle.digest` replaces `createHash`, and the signature comes from the wallet rather
than a local keypair. **Message construction is identical up to the digest** — build the
string, SHA-256 it. What happens after that is not.

> **A wallet does not sign the digest you hand it.** Freighter's `signBlob` treats its
> argument as an opaque **message**, not as bytes to sign: it wraps the string in the
> SEP-0053 envelope and signs `SHA256("Stellar Signed Message:\n" + blob)`. It also returns a
> `Buffer`, not the base64 string its TypeScript signature declares — so
> `JSON.stringify`-ing it straight into the header payload yields
> `{"type":"Buffer","data":[…]}` and the server rejects the header outright with
> `400 INVALID_AUTH_HEADER`, before any signature check runs.
>
> Both behaviours are verified against a real Freighter 2.0.0 signature. The consequence is
> that **the wallet path does not currently interoperate with the server**, which verifies
> the raw digest. Reconciling them — having the server accept the SEP-0053 envelope, or
> versioning the scheme — is an open decision and is deliberately not specified here. If you
> are integrating with a wallet, track that decision before building on this section; if you
> hold the key yourself, the reference implementation above is correct and verified.

---

## 4. Verifying your implementation

Reproduce these values before pointing your client at a live server. The keypair is seeded
with 32 bytes of `0x07`, so you can generate it locally.

```
address     GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57
method      POST
path        /api/follows
timestamp   1735689600000
body        {"followee":"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"}

bodyHash    420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
message     v1:POST:/api/follows:GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57:1735689600000:420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
digest      1bWsu8SkJG10Q5vEoWQZdo3ZIbseNrILzJmuOsP2VyM=   (base64, for inspection)
signature   evOK1CFjMZSTvHtuXrxhDVImMQi9JByqzurli1avrRrEPyjvhhQHYwyAmJLvicSAgHEnOte0qXFBlafhOHjtAw==
```

If `message` matches, you are done — everything after it is standard hashing and signing. If
it does not, compare field by field; the mismatch is almost always the path or the body
hash.

---

## 5. Diagnosing failures

| Status | Code                  | What it usually means                                                                                                                                           |
| ------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | `INVALID_AUTH_HEADER` | Header shape is wrong — bad base64, missing field, wrong scheme, a space inside the payload, or a `signature` that is not a string (see the wallet note in §3). |
| `403`  | `INVALID_TIMESTAMP`   | Your clock is ahead of the server's.                                                                                                                            |
| `403`  | `EXPIRED_TIMESTAMP`   | More than 30 s elapsed, or your clock is behind. Sign immediately before sending.                                                                               |
| `401`  | `INVALID_SIGNATURE`   | The message you signed is not the message the server rebuilt.                                                                                                   |

A `401` after upgrading is almost always one of, in order of likelihood:

1. Signing the router-relative path instead of the absolute one.
2. Hashing a re-serialised body instead of the bytes actually sent.
3. Still sending the old two-field message.
4. Forgetting to upper-case the method.
5. Sending a body but hashing the empty string, or the reverse.

Timestamp checks run **before** the signature check, so an expired credential returns `403`
even when the path is also wrong. Fix clock and freshness problems first, then debug `401`s.

---

## 6. Checklist

- [ ] `bodyHash` computed from the exact bytes sent; empty string hashed when there is no body
- [ ] Path canonicalised: query string dropped, trailing slashes stripped
- [ ] Path is absolute from the indexer root, mount prefix included
- [ ] Method upper-cased
- [ ] Message assembled as `v1:METHOD:path:address:timestamp:bodyHash`
- [ ] Body serialised once and the same variable used for hash and request
- [ ] Signing happens immediately before sending, well inside the 30 s window
- [ ] Worked example in §4 reproduces exactly
- [ ] Endpoints called over HTTPS — see the replay limitation in the spec

---

## 7. Coordination

The old scheme is not accepted alongside the new one. There is no dual-verification window:
the moment the indexer is upgraded, every client still signing the two-field message starts
receiving `401`, and every client already signing the six-field message starts working.

Plan your cutover accordingly, and read
[§9 Known Limitations](./CONTRACT_API.md#9-known-limitations-of-v1) before you build on
`v1` — particularly the absence of a nonce, which leaves identical replay possible inside
the tolerance window.
