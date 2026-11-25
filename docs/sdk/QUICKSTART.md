# Linkora SDK Quickstart

Install the workspace SDK from the repository root:

```bash
pnpm install
pnpm --filter linkora-sdk build
```

The examples assume a deployed Linkora contract and a Soroban RPC URL.

## TypeScript

```ts
import { LinkoraClient } from "linkora-sdk";

const client = new LinkoraClient({
  contractId: process.env.LINKORA_CONTRACT_ID!,
  rpcUrl: process.env.SOROBAN_RPC_URL!,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE!,
  horizonUrl: process.env.HORIZON_URL!,
});

const walletAddress = "G...";
const creatorAddress = "G...";
const creatorToken = "C...";
const tipToken = "C...";

const profile = await client.getProfile(walletAddress);
const profileXdr = client.setProfile(walletAddress, "alice", creatorToken);
const postXdr = client.createPost(walletAddress, "Hello from Linkora");
const followXdr = client.follow(walletAddress, creatorAddress);
const tipXdr = client.tip(walletAddress, 123n, tipToken, 1_000_000n);
```

These write helpers build operation XDR. Use the corresponding `prepare*Tx` methods
when you need a fully submittable transaction with the correct account sequence,
simulation, and fee. Write methods require a configured signer or wallet adapter;
read methods can be called with only the RPC configuration.

## JavaScript

```js
import { LinkoraClient } from "linkora-sdk";

const client = new LinkoraClient({
  contractId: process.env.LINKORA_CONTRACT_ID,
  rpcUrl: process.env.SOROBAN_RPC_URL,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  horizonUrl: process.env.HORIZON_URL,
});

const walletAddress = "G...";
const creatorAddress = "G...";
const creatorToken = "C...";
const tipToken = "C...";

const profile = await client.getProfile(walletAddress);
const profileXdr = client.setProfile(walletAddress, "alice", creatorToken);
const postXdr = client.createPost(walletAddress, "Hello from Linkora");
const followXdr = client.follow(walletAddress, creatorAddress);
const tipXdr = client.tip(walletAddress, 123n, tipToken, 1000000n);
```

Handle rejected simulations and submitted transaction failures at the app boundary:

```ts
try {
  await client.createPost("A post");
} catch (error) {
  console.error("Linkora transaction failed", error);
}
```
