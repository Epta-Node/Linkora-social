import * as rpc from "@stellar/stellar-sdk/rpc";
import {
  Contract,
  nativeToScVal,
  scValToNative,
  Transaction,
  TransactionBuilder,
  Account,
  Keypair,
  StrKey,
  xdr,
} from "@stellar/stellar-base";
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

  /**
   * Ping the RPC endpoint once. Returns true if reachable.
   *
   * @returns A promise that resolves to true if the node responds successfully, false otherwise.
   *
   * @example
   * ```ts
   * const isHealthy = await client.healthCheck();
   * if (!isHealthy) {
   *   console.warn("RPC node is unreachable");
   * }
   * ```
   */
  healthCheck(): Promise<boolean> {
    return this._healthMonitor.healthCheck();
  }

  /**
   * Register a callback for connection status changes ("connected" | "disconnected").
   * Starts the periodic health-check loop on first call if not already running.
   *
   * @param callback Function invoked when the connection state transitions.
   *
   * @example
   * ```ts
   * client.onConnectionStatusChange((status) => {
   *   if (status === "disconnected") {
   *     console.error("Lost connection to Soroban RPC!");
   *   } else {
   *     console.log("Connected to Soroban RPC.");
   *   }
   * });
   * ```
   */
  onConnectionStatusChange(callback: ConnectionStatusCallback): void {
    this._healthMonitor.onConnectionStatusChange(callback);
    this._healthMonitor.start();
  }

  /**
   * Stop the periodic health-check loop.
   *
   * @example
   * ```ts
   * // Clean up resources when shutting down
   * client.stopHealthChecks();
   * ```
   */
  stopHealthChecks(): void {
    this._healthMonitor.stop();
  }

  // ── Soroban simulation and transaction preparation ─────────────────────────

  /**
   * Simulate a write operation and return fee and footprint information.
   * Uses a fresh op factory each call to avoid XDR object reuse across transactions.
   *
   * @param method The contract method to invoke.
   * @param args The arguments to pass to the method, encoded as `xdr.ScVal`.
   *
   * @returns The simulation result, containing the resource fee and ledger footprint.
   *
   * @throws {SimulationError} If the simulation fails (e.g., due to a contract trap or missing authorization).
   *
   * @see {@link https://developers.stellar.org/docs/learn/smart-contract-transactions/simulate-transaction Stellar Simulation Docs}
   *
   * @example
   * ```ts
   * import { nativeToScVal } from "@stellar/stellar-sdk";
   *
   * try {
   *   const result = await client.simulate(
   *     "follow",
   *     nativeToScVal("GBFOY...", { type: "address" }),
   *     nativeToScVal("GCO23...", { type: "address" })
   *   );
   *   console.log("Estimated fee:", result.resourceFee);
   * } catch (error) {
   *   console.error("Simulation failed:", error.message);
   * }
   * ```
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
   *
   * @param method The contract method to invoke.
   * @param sourceAccount The actual Stellar account that will sign and execute the transaction.
   * @param args The arguments to pass to the method, encoded as `xdr.ScVal`.
   *
   * @returns The prepared, unsigned `Transaction` ready for authorization.
   *
   * @throws {SimulationError} If preparing the transaction fails during simulation.
   *
   * @see {@link https://developers.stellar.org/docs/learn/fundamentals/transactions Stellar Transactions Docs}
   *
   * @example
   * ```ts
   * import { Account, nativeToScVal } from "@stellar/stellar-sdk";
   *
   * const sourceAccount = new Account("GBFOY...", "1234567890");
   * try {
   *   const tx = await client.prepareTransaction(
   *     "create_post",
   *     sourceAccount,
   *     nativeToScVal("GBFOY...", { type: "address" }),
   *     nativeToScVal("Hello World")
   *   );
   *   console.log("Prepared transaction XDR:", tx.toEnvelope().toXDR("base64"));
   * } catch (error) {
   *   console.error("Failed to prepare transaction:", error.message);
   * }
   * ```
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
   *
   * @param sourceAccount The Stellar account that will pay the fees and provide sequence.
   * @param ops An array of operations specifying the method names and their arguments.
   *
   * @returns The prepared, unsigned multi-operation `Transaction`.
   *
   * @throws {SimulationError} If the combined simulation of the operations fails.
   *
   * @example
   * ```ts
   * import { Account, nativeToScVal } from "@stellar/stellar-sdk";
   *
   * const sourceAccount = new Account("GBFOY...", "1234567890");
   * try {
   *   const tx = await client.buildMultiOpTx(sourceAccount, [
   *     {
   *       method: "follow",
   *       args: [
   *         nativeToScVal("GBFOY...", { type: "address" }),
   *         nativeToScVal("GCO23...", { type: "address" })
   *       ]
   *     },
   *     {
   *       method: "like_post",
   *       args: [
   *         nativeToScVal("GBFOY...", { type: "address" }),
   *         nativeToScVal(42, { type: "u32" })
   *       ]
   *     }
   *   ]);
   *   console.log("Prepared multi-op transaction hash:", tx.hash().toString("hex"));
   * } catch (error) {
   *   console.error("Failed to build multi-op transaction:", error.message);
   * }
   * ```
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

  /**
   * Fetch a user profile by address.
   *
   * @param address The Stellar public key of the user.
   * @returns The user's Profile, or null if not found.
   *
   * @example
   * ```ts
   * const profile = await client.getProfile("GBFOY...");
   * if (profile) {
   *   console.log(`Username: ${profile.username}`);
   * } else {
   *   console.log("Profile not found.");
   * }
   * ```
   */
  async getProfile(address: string): Promise<Profile | null> {
    try {
      return await super.getProfile(address);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  /**
   * Get the total number of profiles registered on the platform.
   *
   * @returns The total profile count.
   *
   * @example
   * ```ts
   * const count = await client.getProfileCount();
   * console.log(`Total users: ${count.toString()}`);
   * ```
   */
  async getProfileCount(): Promise<bigint> {
    return super.getProfileCount();
  }

  /**
   * Fetch a post by its ID.
   *
   * @param postId The ID of the post.
   * @returns The Post object, or null if it does not exist.
   *
   * @example
   * ```ts
   * const post = await client.getPost(123n);
   * if (post) {
   *   console.log(`Post content: ${post.content}`);
   * } else {
   *   console.log("Post not found.");
   * }
   * ```
   */
  async getPost(postId: number | bigint): Promise<Post | null> {
    try {
      return await super.getPost(BigInt(postId));
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  /**
   * Get the total number of posts created on the platform.
   *
   * @returns The total post count.
   *
   * @example
   * ```ts
   * const count = await client.getPostCount();
   * console.log(`Total posts: ${count.toString()}`);
   * ```
   */
  async getPostCount(): Promise<bigint> {
    return super.getPostCount();
  }

  /**
   * Get the number of likes a post has received.
   *
   * @param postId The ID of the post.
   * @returns The like count.
   *
   * @example
   * ```ts
   * const likes = await client.getLikeCount(123n);
   * console.log(`Post has ${likes.toString()} likes`);
   * ```
   */
  async getLikeCount(postId: number | bigint): Promise<bigint> {
    return super.getLikeCount(BigInt(postId));
  }

  /**
   * Get the current treasury address where protocol fees are sent.
   *
   * @returns The treasury Stellar public key, or null if not set.
   *
   * @example
   * ```ts
   * const treasury = await client.getTreasury();
   * console.log(`Treasury address: ${treasury}`);
   * ```
   */
  async getTreasury(): Promise<string | null> {
    try {
      return await super.getTreasury();
    } catch {
      return null;
    }
  }

  /**
   * Fetch a multi-sig pool by its unique ID.
   *
   * @param poolId The unique identifier of the pool.
   * @returns The Pool object, or null if not found.
   *
   * @example
   * ```ts
   * const pool = await client.getPool("my-community-pool");
   * if (pool) {
   *   console.log(`Pool balance: ${pool.balance.toString()}`);
   * }
   * ```
   */
  async getPool(poolId: string): Promise<Pool | null> {
    try {
      return await super.getPool(poolId);
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  }

  // ── DM key methods ───────────────────────────────────────────────────────

  /**
   * Get the X25519 public key published by a user for encrypted direct messages.
   *
   * @param address The Stellar public key of the user.
   * @returns The 32-byte X25519 public key, or null if not set.
   *
   * @example
   * ```ts
   * const dmKey = await client.getDmKey("GBFOY...");
   * if (dmKey) {
   *   console.log("Found DM key, ready to encrypt messages.");
   * } else {
   *   console.log("User has not published a DM key.");
   * }
   * ```
   */
  async getDmKey(address: string): Promise<Uint8Array | null> {
    try {
      return await super.getDmKey(address);
    } catch {
      return null;
    }
  }

  /**
   * Publish a user's X25519 public key for encrypted direct messages.
   *
   * @param user The Stellar public key of the user.
   * @param x25519PubKey The 32-byte X25519 public key.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @throws {ValidationError} If the public key is not exactly 32 bytes.
   *
   * @example
   * ```ts
   * import { box } from "tweetnacl";
   *
   * const keypair = box.keyPair();
   * const txOp = client.publishDmKey("GBFOY...", keypair.publicKey);
   * console.log("Operation XDR:", txOp);
   * ```
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
   *
   * @param userAddress The Stellar public key of the user.
   * @param x25519PubKey The 32-byte X25519 public key.
   * @param horizonUrl Optional Horizon URL to use. If not provided, it defaults based on the network passphrase.
   *
   * @returns The base64-encoded transaction envelope XDR.
   *
   * @throws {ValidationError} If the public key is not exactly 32 bytes.
   * @throws {NetworkError} If fetching the account sequence from Horizon fails.
   *
   * @see {@link https://developers.stellar.org/api/horizon Stellar Horizon API}
   *
   * @example
   * ```ts
   * import { box } from "tweetnacl";
   *
   * try {
   *   const keypair = box.keyPair();
   *   const txXdr = await client.prepareDmKeyTx(
   *     "GBFOY...",
   *     keypair.publicKey
   *   );
   *   console.log("Ready to sign:", txXdr);
   * } catch (error) {
   *   console.error("Failed to prepare DM key tx:", error.message);
   * }
   * ```
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

  /**
   * Propose a change to a governance parameter.
   *
   * @param proposer The Stellar public key of the proposer.
   * @param parameter The parameter to change.
   * @param newValue The proposed new integer value.
   * @param newAddress The proposed new address, if applicable (e.g., for Treasury).
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @throws {InvalidInputError} If inputs are malformed.
   *
   * @example
   * ```ts
   * import { GovParameter } from "./generated/types";
   *
   * const txOp = client.govPropose(
   *   "GBFOY...",
   *   "FeeBps",
   *   500,
   *   null
   * );
   * console.log("Propose Op XDR:", txOp);
   * ```
   */
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

  /**
   * Vote on an active governance proposal.
   *
   * @param voter The Stellar public key of the voter.
   * @param proposalId The ID of the proposal.
   * @param support True to support, false to reject.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.govVote("GBFOY...", 12n, true);
   * console.log("Vote Op XDR:", txOp);
   * ```
   */
  govVote(voter: string, proposalId: number | bigint, support: boolean): string {
    ensureAddress(voter, "voter");
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govVote(voter, BigInt(proposalId), support);
  }

  /**
   * Execute a successful governance proposal.
   *
   * @param proposalId The ID of the proposal to execute.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.govExecute(12n);
   * console.log("Execute Op XDR:", txOp);
   * ```
   */
  govExecute(proposalId: number | bigint): string {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govExecute(BigInt(proposalId));
  }

  /**
   * Fetch a governance proposal by ID.
   *
   * @param proposalId The ID of the proposal.
   * @returns The GovProposal object.
   *
   * @example
   * ```ts
   * const proposal = await client.govGetProposal(12n);
   * console.log("Proposal parameter:", proposal.parameter);
   * ```
   */
  govGetProposal(proposalId: number | bigint): Promise<GovProposal> {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govGetProposal(BigInt(proposalId));
  }

  /**
   * Get the effective quorum required for a proposal.
   *
   * @param proposalId The ID of the proposal.
   * @returns The number of votes required for quorum.
   *
   * @example
   * ```ts
   * const quorum = await client.effectiveQuorum(12n);
   * console.log("Required quorum:", quorum);
   * ```
   */
  effectiveQuorum(proposalId: number | bigint): Promise<number> {
    ensurePositiveInteger(proposalId, "proposalId");
    return super.effectiveQuorum(BigInt(proposalId));
  }

  /**
   * Veto a governance proposal (requires pool admin authorization).
   *
   * @param signers Array of Stellar public keys of the pool admins signing.
   * @param poolId The ID of the pool whose admins are vetoing.
   * @param proposalId The ID of the proposal to veto.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.govVeto(
   *   ["GBFOY...", "GCO23..."],
   *   "moderation-pool",
   *   12n
   * );
   * console.log("Veto Op XDR:", txOp);
   * ```
   */
  govVeto(signers: string[], poolId: string, proposalId: number | bigint): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensurePositiveInteger(proposalId, "proposalId");
    return super.govVeto(signers, poolId, BigInt(proposalId));
  }

  // ── Override write methods with number→bigint conversions ─────────────────

  /**
   * Set or update a user's profile and link it to their creator token.
   *
   * @param user The Stellar public key of the user.
   * @param username The desired username.
   * @param creatorToken The contract ID of the user's creator token.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.setProfile("GBFOY...", "alice", "CABC123...");
   * console.log("Set Profile Op XDR:", txOp);
   * ```
   */
  setProfile(user: string, username: string, creatorToken: string): string {
    ensureAddress(user, "user");
    ensureNonEmptyString(username, "username");
    ensureAddress(creatorToken, "creatorToken");
    return super.setProfile(user, username, creatorToken);
  }

  /**
   * Delete a user's profile.
   *
   * @param user The Stellar public key of the user.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.deleteProfile("GBFOY...");
   * console.log("Delete Profile Op XDR:", txOp);
   * ```
   */
  deleteProfile(user: string): string {
    ensureAddress(user, "user");
    return super.deleteProfile(user);
  }

  /**
   * Create a new post.
   *
   * @param author The Stellar public key of the author.
   * @param content The text content of the post.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.createPost("GBFOY...", "Hello, Soroban!");
   * console.log("Create Post Op XDR:", txOp);
   * ```
   */
  createPost(author: string, content: string): string {
    ensureAddress(author, "author");
    ensureNonEmptyString(content, "content");
    return super.createPost(author, content);
  }

  /**
   * Delete an existing post.
   *
   * @param author The Stellar public key of the author.
   * @param postId The ID of the post to delete.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.deletePost("GBFOY...", 123n);
   * console.log("Delete Post Op XDR:", txOp);
   * ```
   */
  deletePost(author: string, postId: number | bigint): string {
    ensureAddress(author, "author");
    ensurePositiveInteger(postId, "postId");
    return super.deletePost(author, BigInt(postId));
  }

  /**
   * Follow another user.
   *
   * @param follower The Stellar public key of the follower.
   * @param followee The Stellar public key of the user to follow.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.follow("GBFOY...", "GCO23...");
   * console.log("Follow Op XDR:", txOp);
   * ```
   */
  follow(follower: string, followee: string): string {
    ensureAddress(follower, "follower");
    ensureAddress(followee, "followee");
    return super.follow(follower, followee);
  }

  /**
   * Unfollow a user.
   *
   * @param follower The Stellar public key of the follower.
   * @param followee The Stellar public key of the user to unfollow.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.unfollow("GBFOY...", "GCO23...");
   * console.log("Unfollow Op XDR:", txOp);
   * ```
   */
  unfollow(follower: string, followee: string): string {
    ensureAddress(follower, "follower");
    ensureAddress(followee, "followee");
    return super.unfollow(follower, followee);
  }

  /**
   * Block a user.
   *
   * @param blocker The Stellar public key of the user initiating the block.
   * @param blocked The Stellar public key of the user to block.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.blockUser("GBFOY...", "GCO23...");
   * console.log("Block Op XDR:", txOp);
   * ```
   */
  blockUser(blocker: string, blocked: string): string {
    ensureAddress(blocker, "blocker");
    ensureAddress(blocked, "blocked");
    return super.blockUser(blocker, blocked);
  }

  /**
   * Unblock a previously blocked user.
   *
   * @param blocker The Stellar public key of the user who initiated the block.
   * @param blocked The Stellar public key of the blocked user.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.unblockUser("GBFOY...", "GCO23...");
   * console.log("Unblock Op XDR:", txOp);
   * ```
   */
  unblockUser(blocker: string, blocked: string): string {
    ensureAddress(blocker, "blocker");
    ensureAddress(blocked, "blocked");
    return super.unblockUser(blocker, blocked);
  }

  /**
   * Like a post.
   *
   * @param user The Stellar public key of the user liking the post.
   * @param postId The ID of the post.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.likePost("GBFOY...", 123n);
   * console.log("Like Op XDR:", txOp);
   * ```
   */
  likePost(user: string, postId: number | bigint): string {
    ensureAddress(user, "user");
    ensurePositiveInteger(postId, "postId");
    return super.likePost(user, BigInt(postId));
  }

  /**
   * Tip the author of a post.
   *
   * @param tipper The Stellar public key of the user sending the tip.
   * @param postId The ID of the post whose author will receive the tip.
   * @param token The contract ID of the token used for the tip.
   * @param amount The tip amount in stroops (or smallest decimal unit).
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.tip("GBFOY...", 123n, "CABC123...", 50000000n);
   * console.log("Tip Op XDR:", txOp);
   * ```
   */
  tip(tipper: string, postId: number | bigint, token: string, amount: number | bigint): string {
    ensureAddress(tipper, "tipper");
    ensurePositiveInteger(postId, "postId");
    ensureAddress(token, "token");
    ensurePositiveInteger(amount, "amount");
    return super.tip(tipper, BigInt(postId), token, BigInt(amount));
  }

  /**
   * Create a new multi-sig pool.
   *
   * @param admin The Stellar public key of the pool creator/initial admin.
   * @param poolId The unique identifier for the pool.
   * @param token The contract ID of the token used in this pool.
   * @param initialAdmins Array of Stellar public keys of the initial admins.
   * @param threshold The required signature threshold for pool actions.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.createPool(
   *   "GBFOY...",
   *   "my-pool-1",
   *   "CABC123...",
   *   ["GBFOY...", "GCO23..."],
   *   2
   * );
   * console.log("Create Pool Op XDR:", txOp);
   * ```
   */
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

  /**
   * Deposit tokens into a pool.
   *
   * @param depositor The Stellar public key of the user depositing tokens.
   * @param poolId The ID of the pool.
   * @param token The contract ID of the token.
   * @param amount The amount to deposit.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.poolDeposit("GBFOY...", "my-pool-1", "CABC123...", 1000n);
   * console.log("Deposit Op XDR:", txOp);
   * ```
   */
  poolDeposit(depositor: string, poolId: string, token: string, amount: number | bigint): string {
    ensureAddress(depositor, "depositor");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(token, "token");
    ensurePositiveInteger(amount, "amount");
    return super.poolDeposit(depositor, poolId, token, BigInt(amount));
  }

  /**
   * Withdraw tokens from a pool (requires multi-sig authorization).
   *
   * @param signers Array of Stellar public keys of the admins authorizing the withdrawal.
   * @param poolId The ID of the pool.
   * @param amount The amount to withdraw.
   * @param recipient The Stellar public key to receive the tokens.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.poolWithdraw(
   *   ["GBFOY...", "GCO23..."],
   *   "my-pool-1",
   *   500n,
   *   "GDX..."
   * );
   * console.log("Withdraw Op XDR:", txOp);
   * ```
   */
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

  /**
   * Add a new admin to a pool.
   *
   * @param signers Array of Stellar public keys of the admins authorizing the addition.
   * @param poolId The ID of the pool.
   * @param newAdmin The Stellar public key of the new admin.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.addPoolAdmin(["GBFOY..."], "my-pool-1", "GDX...");
   * console.log("Add Admin Op XDR:", txOp);
   * ```
   */
  addPoolAdmin(signers: string[], poolId: string, newAdmin: string): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(newAdmin, "newAdmin");
    return super.addPoolAdmin(signers, poolId, newAdmin);
  }

  /**
   * Remove an admin from a pool.
   *
   * @param signers Array of Stellar public keys of the admins authorizing the removal.
   * @param poolId The ID of the pool.
   * @param admin The Stellar public key of the admin to remove.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.removePoolAdmin(["GBFOY...", "GCO23..."], "my-pool-1", "GDX...");
   * console.log("Remove Admin Op XDR:", txOp);
   * ```
   */
  removePoolAdmin(signers: string[], poolId: string, admin: string): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureAddress(admin, "admin");
    return super.removePoolAdmin(signers, poolId, admin);
  }

  /**
   * Update the signature threshold required for pool actions.
   *
   * @param signers Array of Stellar public keys of the admins authorizing the change.
   * @param poolId The ID of the pool.
   * @param threshold The new signature threshold.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.updatePoolThreshold(["GBFOY...", "GCO23..."], "my-pool-1", 3n);
   * console.log("Update Threshold Op XDR:", txOp);
   * ```
   */
  updatePoolThreshold(signers: string[], poolId: string, threshold: number | bigint): string {
    ensureAddressList(signers, "signers");
    ensureNonEmptyString(poolId, "poolId");
    ensureInteger(threshold, "threshold", 1);
    return super.updatePoolThreshold(signers, poolId, Number(threshold));
  }

  /**
   * Set the protocol fee in basis points (admin only).
   *
   * @param feeBps The new fee in basis points (e.g., 100 = 1%).
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.setFee(150n); // 1.5%
   * console.log("Set Fee Op XDR:", txOp);
   * ```
   */
  setFee(feeBps: number | bigint): string {
    ensureInteger(feeBps, "feeBps", 0);
    return super.setFee(Number(feeBps));
  }

  /**
   * Set the treasury address where protocol fees are collected (admin only).
   *
   * @param treasury The Stellar public key of the new treasury.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.setTreasury("GBFOY...");
   * console.log("Set Treasury Op XDR:", txOp);
   * ```
   */
  setTreasury(treasury: string): string {
    ensureAddress(treasury, "treasury");
    return super.setTreasury(treasury);
  }

  /**
   * Set the tip cooldown window in ledgers (admin only).
   *
   * @param cooldownLedgers The number of ledgers before a user can tip again.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.setTipCooldownWindow(17280n); // Approx 1 day
   * console.log("Set Cooldown Op XDR:", txOp);
   * ```
   */
  setTipCooldownWindow(cooldownLedgers: number | bigint): string {
    ensureInteger(cooldownLedgers, "cooldownLedgers", 0);
    return super.setTipCooldownWindow(Number(cooldownLedgers));
  }

  /**
   * Build a transaction envelope for `verify_analytics_attestation`.
   *
   * @param oracleName The name of the oracle symbol.
   * @param reportCbor The CBOR-encoded report bytes.
   * @param signature The cryptographic signature of the report.
   * @param creator The Stellar public key of the creator.
   * @param windowStart The start timestamp of the window.
   * @param windowEnd The end timestamp of the window.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @example
   * ```ts
   * const txOp = client.verifyAnalyticsAttestation(
   *   "ORACLE_1",
   *   new Uint8Array([0xa1, 0x61, ...]),
   *   new Uint8Array([...]),
   *   "GBFOY...",
   *   1670000000,
   *   1670086400
   * );
   * console.log("Verify Attestation Op XDR:", txOp);
   * ```
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
   *
   * @param params The token deployment parameters.
   * @returns The base64-encoded XDR of the transaction operation.
   *
   * @throws {ValidationError} If `tokenFactoryId` is not configured.
   *
   * @example
   * ```ts
   * const txOp = client.deployCreatorToken({
   *   deployer: "GBFOY...",
   *   name: "Alice Token",
   *   symbol: "ALC",
   *   decimals: 7,
   *   initialSupply: 1000000n
   * });
   * console.log("Deploy Token Op XDR:", txOp);
   * ```
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
   *
   * @param params The parameters for setting the profile and deploying the token.
   * @returns A tuple of `[deployTxXdr, setProfileTxXdr]`.
   *
   * @throws {ValidationError} If `tokenFactoryId` is not configured.
   *
   * @example
   * ```ts
   * const [deployOp, profileOp] = client.setProfileWithNewToken({
   *   user: "GBFOY...",
   *   username: "alice",
   *   tokenParams: {
   *     name: "Alice Token",
   *     symbol: "ALC",
   *     decimals: 7,
   *     initialSupply: 1000000n
   *   }
   * });
   * console.log("Deploy Op:", deployOp, "Profile Op:", profileOp);
   * ```
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
   *
   * @param params The token deployment parameters.
   * @returns The expected contract ID of the deployed token, or null if simulation fails.
   *
   * @throws {ValidationError} If `tokenFactoryId` is not configured.
   *
   * @example
   * ```ts
   * const tokenAddress = await client.simulateDeployCreatorToken({
   *   deployer: "GBFOY...",
   *   name: "Alice Token",
   *   symbol: "ALC",
   *   decimals: 7,
   *   initialSupply: 1000000n
   * });
   * console.log("Expected token address:", tokenAddress);
   * ```
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
