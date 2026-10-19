import { LinkoraClient } from "linkora-sdk";

import type { StellarNetworkId } from "../context/NetworkContext";

/**
 * Transaction descriptors
 *
 * #1591 — hooks used to hand `useSubmitTx` a plain colon-joined string such as
 * `like_post:GABC…:42` and sign it as if it were base64 XDR. A signer receiving
 * that would either reject it or, worse, sign an unintended transaction.
 *
 * A descriptor is now parsed here and converted into **genuine, simulated
 * base64 XDR** via the shared `linkora-sdk` prepare* helpers before anything is
 * handed to the wallet. Anything that cannot be parsed throws, so a malformed
 * descriptor can never reach the signing path.
 */

/** Network passphrases must match the RPC the client talks to. */
const NETWORK_PASSPHRASE: Record<StellarNetworkId, string> = {
  TESTNET: "Test SDF Network ; September 2022",
  MAINNET: "Public Global Stellar Network ; September 2015",
};

export interface BuildTxOptions {
  contractId: string;
  rpcUrl: string;
  network: StellarNetworkId;
}

/**
 * Stellar addresses and pool ids never contain a colon, so `:` is an
 * unambiguous field separator. Fields are validated individually below rather
 * than trusted, so a malformed descriptor fails loudly.
 */
export function parseTxDescriptor(descriptor: string): {
  method: string;
  args: string[];
} {
  if (typeof descriptor !== "string" || descriptor.trim().length === 0) {
    throw new Error("Transaction descriptor must be a non-empty string");
  }

  const [method, ...args] = descriptor.trim().split(":");
  return { method, args };
}

function requireField(args: string[], index: number, method: string, label: string): string {
  const value = args[index];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Malformed "${method}" descriptor: missing ${label}`);
  }
  return value.trim();
}

function requireU64(args: string[], index: number, method: string, label: string): bigint {
  const raw = requireField(args, index, method, label);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Malformed "${method}" descriptor: ${label} must be a non-negative integer`);
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) {
    throw new Error(`Malformed "${method}" descriptor: ${label} must be greater than zero`);
  }
  return parsed;
}

/**
 * Token amounts arrive from the UI as decimal strings. The contract expects a
 * whole base-unit integer (i128), so anything with a fractional part is
 * rejected rather than silently truncated into a wrong transfer amount.
 */
function requireI128(args: string[], index: number, method: string, label: string): bigint {
  const raw = requireField(args, index, method, label);
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `Malformed "${method}" descriptor: ${label} must be a whole number of base units`
    );
  }
  const parsed = BigInt(raw);
  if (parsed <= 0n) {
    throw new Error(`Malformed "${method}" descriptor: ${label} must be greater than zero`);
  }
  return parsed;
}

/** `pool_withdraw` carries a comma-separated `address=txHash` approval list. */
function parseApprovalList(raw: string, method: string): string[] {
  const signers = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [address, signature] = entry.split("=");
      if (!address || !signature) {
        throw new Error(`Malformed "${method}" descriptor: approval entries must be "address=hash"`);
      }
      return address.trim();
    });

  if (signers.length === 0) {
    throw new Error(`Malformed "${method}" descriptor: at least one signer is required`);
  }
  return signers;
}

/**
 * Map a descriptor to a prepare* helper on the SDK client.
 *
 * Every branch returns real XDR produced by the SDK's shared
 * simulate-and-assemble pipeline. `pool_withdraw_approve` is deliberately not
 * accepted: the contract has no such entrypoint (`packages/contracts` exposes
 * only `pool_withdraw`), so an "approval" can only be a real, wallet-signed
 * `pool_withdraw` invocation.
 */
const DESCRIPTOR_BUILDERS: Record<string, (client: LinkoraClient, args: string[]) => Promise<string>> = {
  like_post: async (client, args) =>
    client.prepareLikePostTx(
      requireField(args, 0, "like_post", "user"),
      requireU64(args, 1, "like_post", "postId")
    ),

  follow: async (client, args) =>
    client.prepareFollowTx(
      requireField(args, 0, "follow", "follower"),
      requireField(args, 1, "follow", "followee")
    ),

  unfollow: async (client, args) =>
    client.prepareUnfollowTx(
      requireField(args, 0, "unfollow", "follower"),
      requireField(args, 1, "unfollow", "followee")
    ),

  block_user: async (client, args) =>
    client.prepareBlockUserTx(
      requireField(args, 0, "block_user", "blocker"),
      requireField(args, 1, "block_user", "blocked")
    ),

  unblock_user: async (client, args) =>
    client.prepareUnblockUserTx(
      requireField(args, 0, "unblock_user", "blocker"),
      requireField(args, 1, "unblock_user", "blocked")
    ),

  tip: async (client, args) =>
    client.prepareTipTx(
      requireField(args, 0, "tip", "tipper"),
      requireU64(args, 1, "tip", "postId"),
      requireField(args, 2, "tip", "token"),
      requireI128(args, 3, "tip", "amount")
    ),

  delete_post: async (client, args) =>
    client.prepareDeletePostTx(
      requireField(args, 0, "delete_post", "author"),
      requireU64(args, 1, "delete_post", "postId")
    ),

  set_profile: async (client, args) =>
    client.prepareSetProfileTx(
      requireField(args, 0, "set_profile", "user"),
      requireField(args, 1, "set_profile", "username"),
      requireField(args, 2, "set_profile", "creatorToken")
    ),

  pool_deposit: async (client, args) =>
    client.preparePoolDepositTx(
      requireField(args, 0, "pool_deposit", "depositor"),
      requireField(args, 1, "pool_deposit", "poolId"),
      requireField(args, 2, "pool_deposit", "token"),
      requireI128(args, 3, "pool_deposit", "amount")
    ),

  pool_withdraw: async (client, args) =>
    client.preparePoolWithdrawTx(
      parseApprovalList(requireField(args, 3, "pool_withdraw", "approvals"), "pool_withdraw"),
      requireField(args, 0, "pool_withdraw", "poolId"),
      requireI128(args, 2, "pool_withdraw", "amount"),
      requireField(args, 1, "pool_withdraw", "recipient")
    ),

  add_pool_admin: async (client, args) =>
    client.prepareAddPoolAdminTx(
      parseApprovalList(requireField(args, 3, "add_pool_admin", "approvals"), "add_pool_admin"),
      requireField(args, 0, "add_pool_admin", "poolId"),
      requireField(args, 1, "add_pool_admin", "newAdmin")
    ),

  remove_pool_admin: async (client, args) =>
    client.prepareRemovePoolAdminTx(
      parseApprovalList(
        requireField(args, 3, "remove_pool_admin", "approvals"),
        "remove_pool_admin"
      ),
      requireField(args, 0, "remove_pool_admin", "poolId"),
      requireField(args, 1, "remove_pool_admin", "admin")
    ),

  update_pool_threshold: async (client, args) =>
    client.prepareUpdatePoolThresholdTx(
      parseApprovalList(
        requireField(args, 3, "update_pool_threshold", "approvals"),
        "update_pool_threshold"
      ),
      requireField(args, 0, "update_pool_threshold", "poolId"),
      requireU64(args, 1, "update_pool_threshold", "threshold")
    ),
};

/** Descriptor methods this module knows how to turn into real XDR. */
export const SUPPORTED_TX_METHODS = Object.keys(DESCRIPTOR_BUILDERS);

/**
 * Convert a descriptor into base64 XDR the wallet can sign.
 *
 * Throws on an unknown method or a malformed descriptor — a signing path must
 * never receive something that is not a real transaction.
 */
export async function buildTxXdr(
  descriptor: string,
  options: BuildTxOptions
): Promise<string> {
  const { method, args } = parseTxDescriptor(descriptor);
  const build = DESCRIPTOR_BUILDERS[method];

  if (!build) {
    throw new Error(`Unsupported transaction descriptor: "${method}"`);
  }

  const client = new LinkoraClient({
    contractId: options.contractId,
    rpcUrl: options.rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE[options.network],
  });

  return build(client, args);
}

export { NETWORK_PASSPHRASE };