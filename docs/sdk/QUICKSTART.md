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

const profile = await client.getProfile(walletAddress);
const post = await client.createPost("Hello from Linkora");
await client.follow(creatorAddress);
await client.tip(creatorAddress, tokenAddress, 1_000_000n);
```

Write methods require a configured signer or wallet adapter. Read methods can be called with only the RPC configuration.

## JavaScript

```js
import { LinkoraClient } from "linkora-sdk";

const client = new LinkoraClient({
  contractId: process.env.LINKORA_CONTRACT_ID,
  rpcUrl: process.env.SOROBAN_RPC_URL,
  networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE,
  horizonUrl: process.env.HORIZON_URL,
});

const profile = await client.getProfile(walletAddress);
const post = await client.createPost("Hello from Linkora");
await client.follow(creatorAddress);
await client.tip(creatorAddress, tokenAddress, 1000000n);
```

Handle rejected simulations and submitted transaction failures at the app boundary:

```ts
try {
  await client.createPost("A post");
} catch (error) {
  console.error("Linkora transaction failed", error);
}
```
