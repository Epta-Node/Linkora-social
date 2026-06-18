import {
  rpc,
  Contract,
  nativeToScVal,
  scValToNative,
  TransactionBuilder,
  Account,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import { Profile, Post, Pool, DeployTokenParams } from "./types";
import { mapError, NotFoundError } from "./errors";

const { isSimulationError, isSimulationSuccess } = rpc.Api;

const DEFAULT_NETWORK = "Test SDF Network ; September 2015";
const DEFAULT_TIMEOUT = 30;

function scvAddress(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

function scvString(value: string): xdr.ScVal {
  return nativeToScVal(value);
}

function scvSymbol(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

function scvU64(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

function scvI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

function scvAddressVec(addresses: string[]): xdr.ScVal {
  return nativeToScVal(addresses.map(scvAddress), { type: "vec" });
}

/**
 * Configuration options for the SDK client
 */
export interface ClientConfig {
  contractId: string;
  /** Contract ID of the token factory contract. Required for deployCreatorToken / setProfileWithNewToken. */
  factoryContractId?: string;
  rpcUrl: string;
  networkPassphrase?: string;
}

/**
 * Typed client for all Linkora social contract methods
 */
export class LinkoraClient {
  private contractId: string;
  private factoryContractId: string | undefined;
  private rpcUrl: string;
  private networkPassphrase: string;

  constructor(config: ClientConfig) {
    this.contractId = config.contractId;
    this.factoryContractId = config.factoryContractId;
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase || DEFAULT_NETWORK;
  }

  private async simulateCall(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal | null> {
    const server = new rpc.Server(this.rpcUrl);
    const contract = new Contract(this.contractId);
    const op = contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    const result = await server.simulateTransaction(tx);

    if (isSimulationError(result)) {
      throw mapError(result.error);
    }
    if (!isSimulationSuccess(result) || !result.result) return null;

    return result.result.retval;
  }

  private buildTx(method: string, ...args: xdr.ScVal[]): string {
    const contract = new Contract(this.contractId);
    const op = contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    return tx.toEnvelope().toXDR("base64");
  }

  private buildTxFor(contractId: string, method: string, ...args: xdr.ScVal[]): string {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    return tx.toEnvelope().toXDR("base64");
  }

  // ── Read Methods ────────────────────────────────────────────────────────────

  async getProfile(address: string): Promise<Profile | null> {
    try {
      const retval = await this.simulateCall("get_profile", scvAddress(address));
      if (!retval) return null;
      const raw = scValToNative(retval);
      if (raw == null) return null;
      return raw as Profile;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async getProfileCount(): Promise<number> {
    const retval = await this.simulateCall("get_profile_count");
    if (!retval) return 0;
    return Number(scValToNative(retval));
  }

  async getAddressByUsername(username: string): Promise<string | null> {
    const retval = await this.simulateCall("get_address_by_username", scvString(username));
    if (!retval) return null;
    const raw = scValToNative(retval);
    return raw == null ? null : (raw as string);
  }

  async getPost(postId: number): Promise<Post | null> {
    try {
      const retval = await this.simulateCall("get_post", scvU64(postId));
      if (!retval) return null;
      const raw = scValToNative(retval);
      if (raw == null) return null;
      return raw as Post;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async getPostCount(): Promise<number> {
    const retval = await this.simulateCall("get_post_count");
    if (!retval) return 0;
    return Number(scValToNative(retval));
  }

  async getPostsByAuthor(author: string, offset: number, limit: number): Promise<number[]> {
    const retval = await this.simulateCall(
      "get_posts_by_author",
      scvAddress(author),
      scvU32(offset),
      scvU32(limit)
    );
    if (!retval) return [];
    return (scValToNative(retval) as bigint[]).map(Number);
  }

  async getFollowing(address: string, offset: number, limit: number): Promise<string[]> {
    const retval = await this.simulateCall(
      "get_following",
      scvAddress(address),
      scvU32(offset),
      scvU32(limit)
    );
    if (!retval) return [];
    return scValToNative(retval) as string[];
  }

  async getFollowers(address: string, offset: number, limit: number): Promise<string[]> {
    const retval = await this.simulateCall(
      "get_followers",
      scvAddress(address),
      scvU32(offset),
      scvU32(limit)
    );
    if (!retval) return [];
    return scValToNative(retval) as string[];
  }

  async isBlocked(blocker: string, blocked: string): Promise<boolean> {
    const retval = await this.simulateCall("is_blocked", scvAddress(blocker), scvAddress(blocked));
    if (!retval) return false;
    return scValToNative(retval) as boolean;
  }

  async hasLiked(address: string, postId: number): Promise<boolean> {
    const retval = await this.simulateCall("has_liked", scvAddress(address), scvU64(postId));
    if (!retval) return false;
    return scValToNative(retval) as boolean;
  }

  async getLikeCount(postId: number): Promise<number> {
    const retval = await this.simulateCall("get_like_count", scvU64(postId));
    if (!retval) return 0;
    return Number(scValToNative(retval));
  }

  async getPool(poolId: string): Promise<Pool | null> {
    try {
      const retval = await this.simulateCall("get_pool", scvSymbol(poolId));
      if (!retval) return null;
      const raw = scValToNative(retval);
      if (raw == null) return null;
      return raw as Pool;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async getPoolAdmins(poolId: string): Promise<string[]> {
    const retval = await this.simulateCall("get_pool_admins", scvSymbol(poolId));
    if (!retval) return [];
    return scValToNative(retval) as string[];
  }

  async getFeeBps(): Promise<number> {
    const retval = await this.simulateCall("get_fee_bps");
    if (!retval) return 0;
    return Number(scValToNative(retval));
  }

  async getTreasury(): Promise<string | null> {
    const retval = await this.simulateCall("get_treasury");
    if (!retval) return null;
    const raw = scValToNative(retval);
    return raw == null ? null : (raw as string);
  }

  async getTipCooldownWindow(): Promise<number> {
    const retval = await this.simulateCall("get_tip_cooldown_window");
    if (!retval) return 0;
    return Number(scValToNative(retval));
  }

  /**
   * Get a user's X25519 public key for direct messages.
   * Returns null if the user hasn't published a DM key.
   */
  async getDmKey(address: string): Promise<Uint8Array | null> {
    const result = await this.simulateCall("get_dm_key", scvAddress(address));
    if (!result) return null;
    const native = scValToNative(result);
    return native ? new Uint8Array(native) : null;
  }

  // ── Write Methods (XDR envelope builders) ───────────────────────────────────

  setProfile(user: string, username: string, creatorToken: string): string {
    return this.buildTx(
      "set_profile",
      scvAddress(user),
      scvString(username),
      scvAddress(creatorToken)
    );
  }

  deleteProfile(user: string): string {
    return this.buildTx("delete_profile", scvAddress(user));
  }

  /**
   * Publish a user's X25519 public key for encrypted direct messages.
   */
  publishDmKey(user: string, x25519PubKey: Uint8Array): string {
    if (x25519PubKey.length !== 32) {
      throw new Error("X25519 public key must be exactly 32 bytes");
    }
    return this.buildTx("publish_dm_key", scvAddress(user), nativeToScVal(Array.from(x25519PubKey), { type: "bytes" }));
  }

  createPost(author: string, content: string): string {
    return this.buildTx("create_post", scvAddress(author), scvString(content));
  }

  deletePost(author: string, postId: number): string {
    return this.buildTx("delete_post", scvAddress(author), scvU64(postId));
  }

  follow(follower: string, followee: string): string {
    return this.buildTx("follow", scvAddress(follower), scvAddress(followee));
  }

  unfollow(follower: string, followee: string): string {
    return this.buildTx("unfollow", scvAddress(follower), scvAddress(followee));
  }

  blockUser(blocker: string, blocked: string): string {
    return this.buildTx("block_user", scvAddress(blocker), scvAddress(blocked));
  }

  unblockUser(blocker: string, blocked: string): string {
    return this.buildTx("unblock_user", scvAddress(blocker), scvAddress(blocked));
  }

  likePost(user: string, postId: number): string {
    return this.buildTx("like_post", scvAddress(user), scvU64(postId));
  }

  tip(tipper: string, postId: number, token: string, amount: number | bigint): string {
    return this.buildTx(
      "tip",
      scvAddress(tipper),
      scvU64(postId),
      scvAddress(token),
      scvI128(amount)
    );
  }

  createPool(
    admin: string,
    poolId: string,
    token: string,
    initialAdmins: string[],
    threshold: number
  ): string {
    return this.buildTx(
      "create_pool",
      scvAddress(admin),
      scvSymbol(poolId),
      scvAddress(token),
      scvAddressVec(initialAdmins),
      scvU32(threshold)
    );
  }

  poolDeposit(depositor: string, poolId: string, token: string, amount: number | bigint): string {
    return this.buildTx(
      "pool_deposit",
      scvAddress(depositor),
      scvSymbol(poolId),
      scvAddress(token),
      scvI128(amount)
    );
  }

  poolWithdraw(
    signers: string[],
    poolId: string,
    amount: number | bigint,
    recipient: string
  ): string {
    return this.buildTx(
      "pool_withdraw",
      scvAddressVec(signers),
      scvSymbol(poolId),
      scvI128(amount),
      scvAddress(recipient)
    );
  }

  addPoolAdmin(signers: string[], poolId: string, newAdmin: string): string {
    return this.buildTx(
      "add_pool_admin",
      scvAddressVec(signers),
      scvSymbol(poolId),
      scvAddress(newAdmin)
    );
  }

  removePoolAdmin(signers: string[], poolId: string, admin: string): string {
    return this.buildTx(
      "remove_pool_admin",
      scvAddressVec(signers),
      scvSymbol(poolId),
      scvAddress(admin)
    );
  }

  updatePoolThreshold(signers: string[], poolId: string, threshold: number): string {
    return this.buildTx(
      "update_pool_threshold",
      scvAddressVec(signers),
      scvSymbol(poolId),
      scvU32(threshold)
    );
  }

  setFee(feeBps: number): string {
    return this.buildTx("set_fee", scvU32(feeBps));
  }

  setTreasury(treasury: string): string {
    return this.buildTx("set_treasury", scvAddress(treasury));
  }

  setTipCooldownWindow(cooldownLedgers: number): string {
    return this.buildTx("set_tip_cooldown_window", scvU32(cooldownLedgers));
  }

  // ── Token Factory Methods ────────────────────────────────────────────────────

  /**
   * Build a transaction envelope that calls `deploy_creator_token` on the
   * token factory contract. The caller must sign and submit this XDR.
   *
   * Returns the base64-encoded XDR transaction envelope.
   * The caller is responsible for extracting the returned token address from
   * the transaction result after submission.
   */
  deployCreatorToken(params: DeployTokenParams): string {
    if (!this.factoryContractId) {
      throw new Error("factoryContractId is required to call deployCreatorToken");
    }
    return this.buildTxFor(
      this.factoryContractId,
      "deploy_creator_token",
      scvAddress(params.deployer),
      scvString(params.name),
      scvString(params.symbol),
      scvU32(params.decimals),
      scvI128(params.initialSupply)
    );
  }

  /**
   * Build the two transaction envelopes needed to deploy a creator token and
   * register a profile in sequence.
   *
   * Returns `{ deployTx, setProfileTx }` where:
   * - `deployTx`      — must be signed/submitted first; the returned address
   *                     from this transaction must be passed as `tokenAddress`
   *                     before building `setProfileTx`.
   * - `setProfileTxBuilder` — a function that accepts the deployed token address
   *                           and returns the `set_profile` XDR envelope.
   *
   * Usage:
   * ```ts
   * const { deployTx, setProfileTxBuilder } = client.setProfileWithNewToken(username, tokenParams);
   * const tokenAddress = await sign_and_submit(deployTx);   // extract from result
   * const setProfileTx = setProfileTxBuilder(tokenAddress);
   * await sign_and_submit(setProfileTx);
   * ```
   */
  setProfileWithNewToken(
    username: string,
    tokenParams: DeployTokenParams
  ): { deployTx: string; setProfileTxBuilder: (tokenAddress: string) => string } {
    const deployTx = this.deployCreatorToken(tokenParams);

    // IMPORTANT: setProfileTxBuilder must only be called after the deploy
    // transaction has been signed, submitted, and confirmed on-chain.  The
    // token address is not known until the deploy transaction result is
    // inspected — passing a speculative or incorrect address here will
    // silently link the wrong contract to the profile.
    const setProfileTxBuilder = (tokenAddress: string): string =>
      this.setProfile(tokenParams.deployer, username, tokenAddress);

    return { deployTx, setProfileTxBuilder };
  }
}
