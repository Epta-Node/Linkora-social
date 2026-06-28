import {
  rpc,
  Contract,
  nativeToScVal,
  scValToNative,
  Transaction,
  TransactionBuilder,
  Account,
  Keypair,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import { GeneratedLinkoraClient } from "./generated/client";
import { Profile, Post, Pool, SimulationResult, LedgerFootprint } from "./types";
import {
  mapError,
  NotFoundError,
  SimulationError,
  InvalidInputError,
  ValidationError,
  NetworkError,
} from "./errors";
import { GovParameter } from "./generated/types";
import type { GovProposal } from "./generated/types";
import { ConnectionHealthMonitor, HealthCheckConfig, ConnectionStatusCallback } from "./health";

const { isSimulationError, isSimulationSuccess } = rpc.Api;

const DEFAULT_NETWORK = "Test SDF Network ; September 2015";
const DEFAULT_TIMEOUT = 30;

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

function ensureNonEmptyString(value: string, fieldName: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${fieldName} must be a non-empty string.`);
  }
}

function ensureAddress(value: string, fieldName: string): void {
  ensureNonEmptyString(value, fieldName);
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new InvalidInputError(`${fieldName} must be a valid Stellar public key.`);
  }
}

function ensureAddressList(values: string[], fieldName: string): void {
  if (!Array.isArray(values)) {
    throw new InvalidInputError(`${fieldName} must be an array of Stellar public keys.`);
  }
  values.forEach((value, index) => ensureAddress(value, `${fieldName}[${index}]`));
}

function ensureInteger(value: number | bigint, fieldName: string, min = 0): bigint {
  if (typeof value === "bigint") {
    if (value < BigInt(min)) {
      throw new InvalidInputError(`${fieldName} must be greater than or equal to ${min}.`);
    }
    return value;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvalidInputError(`${fieldName} must be an integer.`);
  }

  if (value < min) {
    throw new InvalidInputError(`${fieldName} must be greater than or equal to ${min}.`);
  }

  return BigInt(value);
}

function ensurePositiveInteger(value: number | bigint, fieldName: string): bigint {
  return ensureInteger(value, fieldName, 1);
}

function ensureGovParameter(parameter: GovParameter): void {
  const valid = Object.values(GovParameter).includes(parameter);
  if (!valid) {
    throw new InvalidInputError(
      `parameter must be one of: ${Object.values(GovParameter).join(", ")}.`
    );
  }
}

export interface ClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase?: string;
  /** Contract ID of the token factory contract */
  tokenFactoryId?: string;
  /** Connection health-check options */
  healthCheck?: HealthCheckConfig & { autoStart?: boolean };
}

export interface DeployCreatorTokenParams {
  deployer: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
}

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
  private readonly _healthMonitor: ConnectionHealthMonitor;

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

    const { autoStart, ...healthCfg } = config.healthCheck ?? {};
    this._healthMonitor = new ConnectionHealthMonitor(this._rpcUrl, healthCfg);
    if (autoStart) this._healthMonitor.start();
  }

  /** Ping the RPC endpoint once. Returns true if reachable. */
  healthCheck(): Promise<boolean> {
    return this._healthMonitor.healthCheck();
  }

  /**
   * Register a callback for connection status changes ("connected" | "disconnected").
   * Starts the periodic health-check loop on first call if not already running.
   */
  onConnectionStatusChange(callback: ConnectionStatusCallback): void {
    this._healthMonitor.onConnectionStatusChange(callback);
    this._healthMonitor.start();
  }

  /** Stop the periodic health-check loop. */
  stopHealthChecks(): void {
    this._healthMonitor.stop();
  }

  // ── Soroban simulation and transaction preparation ─────────────────────────

  /**
   * Simulate a write operation and return fee and footprint information.
   * Uses a fresh op factory each call to avoid XDR object reuse across transactions.
   */
  async simulate(method: string, ...args: xdr.ScVal[]): Promise<SimulationResult> {
    const server = new rpc.Server(this._rpcUrl);
    const contract = new Contract(this._contractId);
    const buildOp = () => contract.call(method, ...args);

    const source = Keypair.random();
    const account = new Account(source.publicKey(), "0");
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this._networkPassphrase,
    })
      .addOperation(buildOp())
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    const result = await server.simulateTransaction(tx);

    if (isSimulationError(result)) {
      throw new SimulationError(
        `Transaction simulation failed: ${result.error}`,
        result.events,
        result.error
      );
    }

    if (!isSimulationSuccess(result) || !result.result) {
      throw new SimulationError("Unknown simulation error", undefined, result);
    }

    const resourceFee = result.minResourceFee || "0";

    let footprint: LedgerFootprint = { readOnly: [], readWrite: [] };
    if (result.transactionData) {
      try {
        const built = result.transactionData.build();
        footprint = {
          readOnly: built
            .resources()
            .footprint()
            .readOnly()
            .map((e: unknown) => JSON.stringify(e)),
          readWrite: built
            .resources()
            .footprint()
            .readWrite()
            .map((e: unknown) => JSON.stringify(e)),
        };
      } catch {
        // Keep empty footprint if structure extraction fails
      }
    }

    return { success: true, resourceFee, footprint };
  }

  /**
   * Prepare a transaction for signing by simulating it with a temp keypair, then
   * building the real tx for sourceAccount with injected fees and footprint.
   * The operation is built independently for each transaction to avoid XDR state sharing.
   */
  async prepareTransaction(
    method: string,
    sourceAccount: Account,
    ...args: xdr.ScVal[]
  ): Promise<Transaction> {
    const server = new rpc.Server(this._rpcUrl);
    const contract = new Contract(this._contractId);
    const buildOp = () => contract.call(method, ...args);

    const tempSource = Keypair.random();
    const tempAccount = new Account(tempSource.publicKey(), "0");
    const tempTx = new TransactionBuilder(tempAccount, {
      fee: "100",
      networkPassphrase: this._networkPassphrase,
    })
      .addOperation(buildOp())
      .setTimeout(DEFAULT_TIMEOUT)
      .build();

    const simulationResult = await server.simulateTransaction(tempTx);

    if (isSimulationError(simulationResult)) {
      throw new SimulationError(
        `Transaction preparation failed: ${simulationResult.error}`,
        simulationResult.events,
        simulationResult.error
      );
    }

    if (!isSimulationSuccess(simulationResult) || !simulationResult.result) {
      throw new SimulationError(
        "Unknown simulation error during transaction preparation",
        undefined,
        simulationResult
      );
    }

    const resourceFee = simulationResult.minResourceFee || "0";
    const sorobanData = simulationResult.transactionData;

    let builder = new TransactionBuilder(sourceAccount, {
      fee: String(Number(resourceFee) + 100),
      networkPassphrase: this._networkPassphrase,
    })
      .addOperation(buildOp())
      .setTimeout(DEFAULT_TIMEOUT);

    if (sorobanData) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder = (builder as any).setSorobanData(sorobanData);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (builder as any).build() as Transaction;
  }

  /**
   * Build a multi-operation transaction with multiple Soroban invocations.
   * Operations are freshly constructed for both the simulation and the real transaction
   * to avoid XDR object reuse across different TransactionBuilder instances.
   */
  async buildMultiOpTx(
    sourceAccount: Account,
    ops: Array<{ method: string; args: xdr.ScVal[] }>
  ): Promise<Transaction> {
    const server = new rpc.Server(this._rpcUrl);
    const contract = new Contract(this._contractId);

    const tempSource = Keypair.random();
    const tempAccount = new Account(tempSource.publicKey(), "0");
    const tempBuilder = new TransactionBuilder(tempAccount, {
      fee: "100",
      networkPassphrase: this._networkPassphrase,
    });
    for (const op of ops) {
      tempBuilder.addOperation(contract.call(op.method, ...op.args));
    }
    const tempTx = tempBuilder.setTimeout(DEFAULT_TIMEOUT).build();

    const simulationResult = await server.simulateTransaction(tempTx);

    if (isSimulationError(simulationResult)) {
      throw new SimulationError(
        `Multi-operation transaction simulation failed: ${simulationResult.error}`,
        simulationResult.events,
        simulationResult.error
      );
    }

    if (!isSimulationSuccess(simulationResult) || !simulationResult.result) {
      throw new SimulationError(
        "Unknown simulation error during multi-op transaction preparation",
        undefined,
        simulationResult
      );
    }

    const resourceFee = simulationResult.minResourceFee || "0";
    const sorobanData = simulationResult.transactionData;

    const realBuilder = new TransactionBuilder(sourceAccount, {
      fee: String(Number(resourceFee) + 100),
      networkPassphrase: this._networkPassphrase,
    });
    for (const op of ops) {
      realBuilder.addOperation(contract.call(op.method, ...op.args));
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let readyBuilder: any = realBuilder.setTimeout(DEFAULT_TIMEOUT);

    if (sorobanData) {
      readyBuilder = readyBuilder.setSorobanData(sorobanData);
    }

    return readyBuilder.build() as Transaction;
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
      throw new ValidationError("X25519 public key must be exactly 32 bytes", {
        actual: x25519PubKey.length,
        expected: 32,
      });
    }
    return super.publishDmKey(user, x25519PubKey);
  }

  /**
   * Build a publish_dm_key transaction with the caller as the proper source
   * account so it can be signed directly by a browser wallet (e.g. Freighter).
   *
   * Unlike publishDmKey(), which uses a random placeholder account, this method:
   *  1. Fetches the real account sequence from Horizon.
   *  2. Simulates the transaction to obtain accurate resource fees.
   *  3. Returns a base64-encoded XDR ready for wallet signing and RPC submission.
   */
  async prepareDmKeyTx(
    userAddress: string,
    x25519PubKey: Uint8Array,
    horizonUrl?: string
  ): Promise<string> {
    if (x25519PubKey.length !== 32) {
      throw new ValidationError("X25519 public key must be exactly 32 bytes", {
        actual: x25519PubKey.length,
        expected: 32,
      });
    }

    const horizon =
      horizonUrl ??
      (this._networkPassphrase.includes("Test")
        ? "https://horizon-testnet.stellar.org"
        : "https://horizon.stellar.org");

    const res = await fetch(`${horizon}/accounts/${userAddress}`);
    if (!res.ok) {
      throw new NetworkError(
        `Could not fetch account from Horizon (HTTP ${res.status}). ` +
          `Make sure the wallet is funded on the correct network.`
      );
    }
    const data = (await res.json()) as { sequence: string };

    const sourceAccount = new Account(userAddress, data.sequence);
    const tx = await this.prepareTransaction(
      "publish_dm_key",
      sourceAccount,
      nativeToScVal(userAddress, { type: "address" }),
      nativeToScVal(Array.from(x25519PubKey), { type: "bytes" })
    );

    return tx.toEnvelope().toXDR("base64");
  }

  // ── Governance convenience overrides ──────────────────────────────────────

  govPropose(
    proposer: string,
    parameter: GovParameter,
    newValue: number | bigint,
    newAddress: string | null
  ): string {
    ensureAddress(proposer, "proposer");
    ensureGovParameter(parameter);
    ensureInteger(newValue, "newValue");
    if (newAddress !== null) {
      ensureAddress(newAddress, "newAddress");
    }
    return super.govPropose(proposer, parameter, BigInt(newValue), newAddress);
  }

  govVote(voter: string, proposalId: number | bigint, support: boolean): string {
    ensureAddress(voter, "voter");
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govVote(voter, BigInt(proposalId), support);
  }

  govExecute(proposalId: number | bigint): string {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govExecute(BigInt(proposalId));
  }

  govGetProposal(proposalId: number | bigint): Promise<GovProposal> {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govGetProposal(BigInt(proposalId));
  }

  effectiveQuorum(proposalId: number | bigint): Promise<number> {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.effectiveQuorum(BigInt(proposalId));
  }

  govVeto(signers: string[], poolId: string, proposalId: number | bigint): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govVeto(signers, poolId, BigInt(proposalId));
  }

  // ── Override write methods with number→bigint conversions ─────────────────

  setProfile(user: string, username: string, creatorToken: string): string {
    ensureAddress(user, "user");
    ensureNonEmptyString(username, "username");
    ensureAddress(creatorToken, "creatorToken");
    return super.setProfile(user, username, creatorToken);
  }

  deleteProfile(user: string): string {
    ensureAddress(user, "user");
    return super.deleteProfile(user);
  }

  createPost(author: string, content: string): string {
    ensureAddress(author, "author");
    ensureNonEmptyString(content, "content");
    return super.createPost(author, content);
  }

  deletePost(author: string, postId: number | bigint): string {
    ensureAddress(author, "author");
    ensurePositiveInteger(postId, "postId");
    return super.deletePost(author, BigInt(postId));
  }

  follow(follower: string, followee: string): string {
    ensureAddress(follower, "follower");
    ensureAddress(followee, "followee");
    return super.follow(follower, followee);
  }

  unfollow(follower: string, followee: string): string {
    ensureAddress(follower, "follower");
    ensureAddress(followee, "followee");
    return super.unfollow(follower, followee);
  }

  blockUser(blocker: string, blocked: string): string {
    ensureAddress(blocker, "blocker");
    ensureAddress(blocked, "blocked");
    return super.blockUser(blocker, blocked);
  }

  unblockUser(blocker: string, blocked: string): string {
    ensureAddress(blocker, "blocker");
    ensureAddress(blocked, "blocked");
    return super.unblockUser(blocker, blocked);
  }

  likePost(user: string, postId: number | bigint): string {
    ensureAddress(user, "user");
    ensurePositiveInteger(postId, "postId");
    return super.likePost(user, BigInt(postId));
  }

  tip(tipper: string, postId: number | bigint, token: string, amount: number | bigint): string {
    ensureAddress(tipper, "tipper");
    ensurePositiveInteger(postId, "postId");
    ensureAddress(token, "token");
    ensurePositiveInteger(amount, "amount");
    return super.tip(tipper, BigInt(postId), token, BigInt(amount));
  }

  createPool(
    admin: string,
    poolId: string,
    token: string,
    initialAdmins: string[],
    threshold: number | bigint
  ): string {
    ensureAddress(admin, "admin");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(token, "token");
    ensureAddressList(initialAdmins, "initialAdmins");
    ensureInteger(threshold, "threshold", 1);
    return super.createPool(admin, poolId, token, initialAdmins, Number(threshold));
  }

  poolDeposit(depositor: string, poolId: string, token: string, amount: number | bigint): string {
    ensureAddress(depositor, "depositor");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(token, "token");
    ensurePositiveInteger(amount, "amount");
    return super.poolDeposit(depositor, poolId, token, BigInt(amount));
  }

  poolWithdraw(
    signers: string[],
    poolId: string,
    amount: number | bigint,
    recipient: string
  ): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensurePositiveInteger(amount, "amount");
    ensureAddress(recipient, "recipient");
    return super.poolWithdraw(signers, poolId, BigInt(amount), recipient);
  }

  addPoolAdmin(signers: string[], poolId: string, newAdmin: string): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(newAdmin, "newAdmin");
    return super.addPoolAdmin(signers, poolId, newAdmin);
  }

  removePoolAdmin(signers: string[], poolId: string, admin: string): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(admin, "admin");
    return super.removePoolAdmin(signers, poolId, admin);
  }

  updatePoolThreshold(signers: string[], poolId: string, threshold: number | bigint): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureInteger(threshold, "threshold", 1);
    return super.updatePoolThreshold(signers, poolId, Number(threshold));
  }

  setFee(feeBps: number | bigint): string {
    ensureInteger(feeBps, "feeBps", 0);
    return super.setFee(Number(feeBps));
  }

  setTreasury(treasury: string): string {
    ensureAddress(treasury, "treasury");
    return super.setTreasury(treasury);
  }

  setTipCooldownWindow(cooldownLedgers: number | bigint): string {
    ensureInteger(cooldownLedgers, "cooldownLedgers", 0);
    return super.setTipCooldownWindow(Number(cooldownLedgers));
  }

  /**
   * Build a transaction envelope for `verify_analytics_attestation`.
   */
  verifyAnalyticsAttestation(
    oracleName: string,
    reportCbor: Uint8Array,
    signature: Uint8Array,
    creator: string,
    windowStart: number,
    windowEnd: number
  ): string {
    ensureNonEmptyString(oracleName, "oracleName");
    ensureAddress(creator, "creator");
    ensureInteger(windowStart, "windowStart", 0);
    ensureInteger(windowEnd, "windowEnd", 0);
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
   * factory contract.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  deployCreatorToken(params: DeployCreatorTokenParams): string {
    if (!this.tokenFactoryId) {
      throw new ValidationError(
        "tokenFactoryId must be set in ClientConfig to use deployCreatorToken",
        {
          field: "tokenFactoryId",
        }
      );
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
   * Build two sequential transaction XDRs that together deploy a creator token
   * and set the user's profile with the new token address.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  setProfileWithNewToken(params: SetProfileWithNewTokenParams): [string, string] {
    if (!this.tokenFactoryId) {
      throw new ValidationError(
        "tokenFactoryId must be set in ClientConfig to use setProfileWithNewToken",
        {
          field: "tokenFactoryId",
        }
      );
    }
    const deployTx = this.deployCreatorToken({
      deployer: params.user,
      ...params.tokenParams,
    });
    // NOTE: the token address used here is a placeholder; callers should
    // first simulate deployCreatorToken to get the real token address, then
    // call setProfile(user, username, tokenAddress) directly.
    const profileTx = this.setProfile(params.user, params.username, params.user);
    return [deployTx, profileTx];
  }

  /**
   * Simulate `deploy_creator_token` to determine the token address that would
   * be created. Does not submit a transaction.
   *
   * Requires `tokenFactoryId` to be set in `ClientConfig`.
   */
  async simulateDeployCreatorToken(params: DeployCreatorTokenParams): Promise<string | null> {
    if (!this.tokenFactoryId) {
      throw new ValidationError(
        "tokenFactoryId must be set in ClientConfig to use simulateDeployCreatorToken",
        { field: "tokenFactoryId" }
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
}
