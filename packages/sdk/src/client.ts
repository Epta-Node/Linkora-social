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
import { NotFoundError, mapError } from "./errors";
import { GeneratedLinkoraClient } from "./generated/client";
import type { Profile, Post, Pool, GovParameter, GovProposal } from "./types";

const DEFAULT_NETWORK = "Test SDF Network ; September 2015";
const DEFAULT_TIMEOUT = 30;

const { isSimulationError, isSimulationSuccess } = rpc.Api;

function scvAddress(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}
function scvString(value: string): xdr.ScVal {
  return nativeToScVal(value);
}
function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}
function scvI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

/**
 * Configuration options for the SDK client
 */
export interface ClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase?: string;
  /** Contract ID of the token factory contract */
  tokenFactoryId?: string;
}

/**
 * Parameters for deploying a creator token via the factory.
 */
export interface DeployCreatorTokenParams {
  deployer: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
}

/**
 * Parameters for setting a profile with a new token in one flow.
 */
export interface SetProfileWithNewTokenParams {
  user: string;
  username: string;
  tokenParams: Omit<DeployCreatorTokenParams, "deployer">;
}

/**
 * Typed client for all Linkora social contract methods.
 *
 * Extends the auto-generated GeneratedLinkoraClient with connection management,
 * error handling, and type conversions (e.g. bigint ↔ number).
 */
export class LinkoraClient extends GeneratedLinkoraClient {
  private tokenFactoryId?: string;
  private readonly _rpcUrl: string;
  private readonly _networkPassphrase: string;
  private readonly _contractId: string;

  constructor(config: ClientConfig) {
    super({
      contractId: config.contractId,
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase || DEFAULT_NETWORK,
    });
    this._contractId = config.contractId;
    this.tokenFactoryId = config.tokenFactoryId;
    this._rpcUrl = config.rpcUrl;
    this._networkPassphrase = config.networkPassphrase || DEFAULT_NETWORK;
  }

  // ── Override read methods with error handling ─────────────────────────────

  async getProfile(address: string): Promise<Profile | null> {
    try {
      return await super.getProfile(address);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async getProfileCount(): Promise<bigint> {
    return super.getProfileCount();
  }

  async getPost(postId: number | bigint): Promise<Post | null> {
    try {
      return await super.getPost(BigInt(postId));
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async getPostCount(): Promise<bigint> {
    return super.getPostCount();
  }

  async getLikeCount(postId: number | bigint): Promise<bigint> {
    return super.getLikeCount(BigInt(postId));
  }

  async getTreasury(): Promise<string | null> {
    try {
      return await super.getTreasury();
    } catch {
      return null;
    }
  }

  async getPool(poolId: string): Promise<Pool | null> {
    try {
      return await super.getPool(poolId);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  // ── DM key methods ───────────────────────────────────────────────────────

  async getDmKey(address: string): Promise<Uint8Array | null> {
    try {
      return await super.getDmKey(address);
    } catch {
      return null;
    }
  }

  /**
   * Publish a user's X25519 public key for encrypted direct messages.
   */
  publishDmKey(user: string, x25519PubKey: Uint8Array): string {
    if (x25519PubKey.length !== 32) {
      throw new Error("X25519 public key must be exactly 32 bytes");
    }
    return super.publishDmKey(user, x25519PubKey);
  }

  // ── Governance convenience overrides ──────────────────────────────────────

  govPropose(
    proposer: string,
    parameter: GovParameter,
    newValue: number | bigint,
    newAddress: string | null
  ): string {
    return super.govPropose(proposer, parameter, BigInt(newValue), newAddress);
  }

  govVote(voter: string, proposalId: number | bigint, support: boolean): string {
    return super.govVote(voter, BigInt(proposalId), support);
  }

  govExecute(proposalId: number | bigint): string {
    return super.govExecute(BigInt(proposalId));
  }

  govGetProposal(proposalId: number | bigint): Promise<GovProposal> {
    return super.govGetProposal(BigInt(proposalId));
  }

  effectiveQuorum(proposalId: number | bigint): Promise<number> {
    return super.effectiveQuorum(BigInt(proposalId));
  }

  govVeto(signers: string[], poolId: string, proposalId: number | bigint): string {
    return super.govVeto(signers, poolId, BigInt(proposalId));
  }

  // ── Override write methods with number→bigint conversions ─────────────────

  deletePost(author: string, postId: number | bigint): string {
    return super.deletePost(author, BigInt(postId));
  }

  likePost(user: string, postId: number | bigint): string {
    return super.likePost(user, BigInt(postId));
  }

  tip(tipper: string, postId: number | bigint, token: string, amount: number | bigint): string {
    return super.tip(tipper, BigInt(postId), token, BigInt(amount));
  }

  poolDeposit(depositor: string, poolId: string, token: string, amount: number | bigint): string {
    return super.poolDeposit(depositor, poolId, token, BigInt(amount));
  }

  poolWithdraw(
    signers: string[],
    poolId: string,
    amount: number | bigint,
    recipient: string
  ): string {
    return super.poolWithdraw(signers, poolId, BigInt(amount), recipient);
  }

  // ── Analytics Oracle ────────────────────────────────────────────────────────

  /**
   * Build a transaction envelope for `verify_analytics_attestation`.
   * Submitting this transaction anchors the attestation on-chain and emits
   * `AttestationVerifiedEvent`.
   *
   * @param oracleName - Symbol name of the oracle (e.g. "default")
   * @param reportCbor - Raw CBOR bytes of the analytics report
   * @param signature  - 64-byte Ed25519 signature over sha256(reportCbor)
   * @param creator    - Creator address represented by the report
   * @param windowStart - Start ledger for the report window
   * @param windowEnd  - End ledger for the report window
   */
  verifyAnalyticsAttestation(
    oracleName: string,
    reportCbor: Uint8Array,
    signature: Uint8Array,
    creator: string,
    windowStart: number,
    windowEnd: number
  ): string {
    return this.buildTxForContract(
      this._contractId,
      "verify_analytics_attestation",
      nativeToScVal(oracleName, { type: "symbol" }),
      nativeToScVal(Buffer.from(reportCbor), { type: "bytes" }),
      nativeToScVal(Buffer.from(signature), { type: "bytes" }),
      scvAddress(creator),
      nativeToScVal(windowStart, { type: "u64" }),
      nativeToScVal(windowEnd, { type: "u64" })
    );
  }

  // ── Token Factory Methods ────────────────────────────────────────────────────

  /**
   * Build a transaction XDR that calls `deploy_creator_token` on the token
   * factory contract.  The caller must sign this XDR via Freighter and submit
   * it before calling `setProfile` with the returned token address.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  deployCreatorToken(params: DeployCreatorTokenParams): string {
    if (!this.tokenFactoryId) {
      throw new Error("tokenFactoryId must be set in ClientConfig to use deployCreatorToken");
    }
    return this.buildTxForContract(
      this.tokenFactoryId,
      "deploy_creator_token",
      scvAddress(params.deployer),
      scvString(params.name),
      scvString(params.symbol),
      scvU32(params.decimals),
      scvI128(params.initialSupply)
    );
  }

  /**
   * Build two sequential transaction XDRs that together:
   * 1. Deploy a creator token via the factory contract.
   * 2. Call `set_profile` on the Linkora contract with the new token address.
   *
   * Returns an ordered array of XDR strings.  The caller must sign and submit
   * them in sequence (e.g. via TransactionQueue) because the token address
   * returned by (1) is needed as input for (2).
   *
   * IMPORTANT: In practice the token address from tx (1) must be extracted
   * from the simulation result before (2) can be built with the real address.
   * Use `simulateDeployCreatorToken` to get the token address first, then call
   * `setProfile` with it.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  setProfileWithNewToken(params: SetProfileWithNewTokenParams): [string, string] {
    if (!this.tokenFactoryId) {
      throw new Error("tokenFactoryId must be set in ClientConfig to use setProfileWithNewToken");
    }
    const deployTx = this.deployCreatorToken({
      deployer: params.user,
      ...params.tokenParams,
    });
    // NOTE: the token address used here is a placeholder; callers should
    // first simulate deployCreatorToken to get the real token address, then
    // call setProfile(user, username, tokenAddress) directly.  This method
    // exists for TransactionQueue pre-building and testing the sequencing.
    const profileTx = this.setProfile(params.user, params.username, params.user);
    return [deployTx, profileTx];
  }

  /**
   * Simulate `deploy_creator_token` to determine the token address that would
   * be created.  Does not submit a transaction.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  async simulateDeployCreatorToken(params: DeployCreatorTokenParams): Promise<string | null> {
    if (!this.tokenFactoryId) {
      throw new Error(
        "tokenFactoryId must be set in ClientConfig to use simulateDeployCreatorToken"
      );
    }
    const retval = await this.simulateCallOnContract(
      this.tokenFactoryId,
      "deploy_creator_token",
      scvAddress(params.deployer),
      scvString(params.name),
      scvString(params.symbol),
      scvU32(params.decimals),
      scvI128(params.initialSupply)
    );
    if (!retval) return null;
    const native = scValToNative(retval);
    return native == null ? null : (native as string);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private buildTxForContract(contractId: string, method: string, ...args: xdr.ScVal[]): string {
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this._networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    return tx.toEnvelope().toXDR("base64");
  }

  private async simulateCallOnContract(
    contractId: string,
    method: string,
    ...args: xdr.ScVal[]
  ): Promise<xdr.ScVal | null> {
    const server = new rpc.Server(this._rpcUrl);
    const contract = new Contract(contractId);
    const op = contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this._networkPassphrase,
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

  // ── Governance Methods ──────────────────────────────────────────────────────

  async govGetConfig(): Promise<GovConfig | null> {
    try {
      const retval = await this.simulateCall("gov_get_config");
      if (!retval) return null;
      const raw = scValToNative(retval);
      if (raw == null) return null;
      return raw as GovConfig;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  async govGetProposal(proposalId: number): Promise<GovProposal | null> {
    try {
      const retval = await this.simulateCall("gov_get_proposal", scvU64(proposalId));
      if (!retval) return null;
      const raw = scValToNative(retval);
      if (raw == null) return null;
      return raw as GovProposal;
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  govPropose(
    user: string,
    parameter: GovParameter,
    newValue: number,
    newAddress?: string | null
  ): string {
    const scvParam = scvSymbol(parameter);
    const scvAddr = newAddress ? scvAddress(newAddress) : xdr.ScVal.scvVoid();
    return this.buildTx(
      "gov_propose",
      scvAddress(user),
      scvParam,
      scvU64(newValue),
      scvAddr
    );
  }

  govVote(user: string, proposalId: number, support: boolean): string {
    return this.buildTx(
      "gov_vote",
      scvAddress(user),
      scvU64(proposalId),
      nativeToScVal(support, { type: "bool" })
    );
  }

  govExecute(proposalId: number): string {
    return this.buildTx("gov_execute", scvU64(proposalId));
  }

  govVeto(signers: string[], poolId: string, proposalId: number): string {
    return this.buildTx(
      "gov_veto",
      scvAddressVec(signers),
      scvSymbol(poolId),
      scvU64(proposalId)
    );
  }
}
