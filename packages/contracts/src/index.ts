/**
 * Typed TypeScript client for the Linkora Soroban contract.
 *
 * Generated / maintained via:
 *   pnpm --filter contracts generate:bindings
 *
 * The client is built on top of @stellar/stellar-sdk and mirrors every
 * public function exported by lib.rs.  All types below correspond to the
 * #[contracttype] structs and enums defined in the contract.
 */

import {
  Contract,
  ContractSpec,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";
export type { StellarRpc };

// ── Re-export stellar-sdk primitives that callers commonly need ───────────────
export { Address };

// ── Contract data types ───────────────────────────────────────────────────────

export interface Post {
  id: bigint;
  author: string;
  content: string;
  tip_total: bigint;
  timestamp: bigint;
  like_count: bigint;
}

export interface Profile {
  address: string;
  username: string;
  creator_token: string;
}

export interface Pool {
  token: string;
  balance: bigint;
  admins: string[];
  threshold: number;
}

// ── Client configuration ──────────────────────────────────────────────────────

export interface LinkoraClientConfig {
  /** Stellar RPC endpoint URL */
  rpcUrl: string;
  /** Deployed contract ID (C...) */
  contractId: string;
  /** Network passphrase, e.g. "Test SDF Network ; September 2015" */
  networkPassphrase: string;
}

// ── Typed client ──────────────────────────────────────────────────────────────

export class LinkoraClient {
  private readonly contract: Contract;
  private readonly server: StellarRpc.Server;
  private readonly networkPassphrase: string;

  constructor(config: LinkoraClientConfig) {
    this.contract = new Contract(config.contractId);
    this.server = new StellarRpc.Server(config.rpcUrl);
    this.networkPassphrase = config.networkPassphrase;
  }

  // ── Profiles ────────────────────────────────────────────────────────────────

  async getProfile(user: string): Promise<Profile | null> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_profile", [Address.fromString(user).toScVal()])
    );
    return parseOptional<Profile>(result);
  }

  async getProfileCount(): Promise<bigint> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_profile_count", [])
    );
    return scValToNative(extractReturnValue(result)) as bigint;
  }

  // ── Social Graph ─────────────────────────────────────────────────────────────

  async getFollowing(
    user: string,
    offset: number,
    limit: number
  ): Promise<string[]> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_following", [
        Address.fromString(user).toScVal(),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ])
    );
    return scValToNative(extractReturnValue(result)) as string[];
  }

  async getFollowers(
    user: string,
    offset: number,
    limit: number
  ): Promise<string[]> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_followers", [
        Address.fromString(user).toScVal(),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ])
    );
    return scValToNative(extractReturnValue(result)) as string[];
  }

  async isBlocked(blocker: string, blocked: string): Promise<boolean> {
    const result = await this.server.simulateTransaction(
      this.buildTx("is_blocked", [
        Address.fromString(blocker).toScVal(),
        Address.fromString(blocked).toScVal(),
      ])
    );
    return scValToNative(extractReturnValue(result)) as boolean;
  }

  // ── Posts ────────────────────────────────────────────────────────────────────

  async getPost(id: bigint): Promise<Post | null> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_post", [nativeToScVal(id, { type: "u64" })])
    );
    return parseOptional<Post>(result);
  }

  async getPostCount(): Promise<bigint> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_post_count", [])
    );
    return scValToNative(extractReturnValue(result)) as bigint;
  }

  async getPostsByAuthor(
    author: string,
    offset: number,
    limit: number
  ): Promise<bigint[]> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_posts_by_author", [
        Address.fromString(author).toScVal(),
        nativeToScVal(offset, { type: "u32" }),
        nativeToScVal(limit, { type: "u32" }),
      ])
    );
    return scValToNative(extractReturnValue(result)) as bigint[];
  }

  async getLikeCount(postId: bigint): Promise<bigint> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_like_count", [nativeToScVal(postId, { type: "u64" })])
    );
    return scValToNative(extractReturnValue(result)) as bigint;
  }

  async hasLiked(user: string, postId: bigint): Promise<boolean> {
    const result = await this.server.simulateTransaction(
      this.buildTx("has_liked", [
        Address.fromString(user).toScVal(),
        nativeToScVal(postId, { type: "u64" }),
      ])
    );
    return scValToNative(extractReturnValue(result)) as boolean;
  }

  // ── Community Pool ───────────────────────────────────────────────────────────

  async getPool(poolId: string): Promise<Pool | null> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_pool", [
        nativeToScVal(poolId, { type: "symbol" }),
      ])
    );
    return parseOptional<Pool>(result);
  }

  // ── Fee & Treasury ───────────────────────────────────────────────────────────

  async getFeeBps(): Promise<number> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_fee_bps", [])
    );
    return scValToNative(extractReturnValue(result)) as number;
  }

  async getTreasury(): Promise<string | null> {
    const result = await this.server.simulateTransaction(
      this.buildTx("get_treasury", [])
    );
    return parseOptional<string>(result);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private buildTx(method: string, args: xdr.ScVal[]) {
    // Returns a minimal Transaction envelope suitable for simulateTransaction.
    // Callers that need to submit signed transactions should construct the full
    // transaction themselves using TransactionBuilder with the source account.
    const op = this.contract.call(method, ...args);
    // Wrap in a trivial envelope so the RPC server can simulate it.
    const { Transaction, TransactionBuilder, BASE_FEE, Networks } =
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    const source = new (require("@stellar/stellar-sdk").Account)(
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      "0"
    );
    return new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractReturnValue(
  result: StellarRpc.Api.SimulateTransactionResponse
): xdr.ScVal {
  if (StellarRpc.Api.isSimulationError(result)) {
    throw new Error(`Simulation error: ${result.error}`);
  }
  const success = result as StellarRpc.Api.SimulateTransactionSuccessResponse;
  if (!success.result) {
    throw new Error("No return value from simulation");
  }
  return success.result.retval;
}

function parseOptional<T>(
  result: StellarRpc.Api.SimulateTransactionResponse
): T | null {
  const val = extractReturnValue(result);
  const native = scValToNative(val);
  if (native === undefined || native === null) return null;
  return native as T;
}
