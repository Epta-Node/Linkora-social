/**
 * Shared E2E test setup utilities.
 *
 * Provides helpers for:
 * - Account creation and funding (via friendbot)
 * - Contract deployment (via stellar CLI for bootstrap)
 * - SDK client initialization
 * - SDK-based transaction signing and submission
 * - Polling/retry for eventually-consistent indexer state
 * - Retry loops for on-chain state verification
 * - Cleanup and teardown
 */

import { execSync, spawnSync } from "child_process";
import path from "path";
import { createHash } from "crypto";
import {
  Asset,
  Keypair,
  Account,
  nativeToScVal,
  xdr,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";

// sha256 helper using Node's built-in crypto (no extra dependency needed).
function sha256(data: Uint8Array): Uint8Array {
  return createHash("sha256").update(data).digest();
}
import { LinkoraClient } from "@linkora/sdk";

// Node 18+ has global fetch. Use it or fallback.
const _fetch: typeof globalThis.fetch =
  typeof globalThis.fetch === "function"
    ? globalThis.fetch
    : // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("node-fetch");

// ─── Configuration ────────────────────────────────────────────────────────────

export const TEST_CONFIG = {
  rpcUrl: process.env.E2E_RPC_URL || "http://localhost:8000/soroban/rpc",
  friendbotUrl: process.env.E2E_FRIENDBOT_URL || "http://localhost:8000/friendbot",
  horizonUrl: process.env.E2E_HORIZON_URL || "http://localhost:8000",
  indexerUrl: process.env.E2E_INDEXER_URL || "http://localhost:3000",
  relayUrl: process.env.E2E_RELAY_URL || "http://localhost:3001",
  networkPassphrase: process.env.E2E_NETWORK_PASSPHRASE || "Standalone Network ; February 2017",
  contractId: process.env.CONTRACT_ID || "",
  tokenId: process.env.TOKEN_ID || "",
  cfgDir: process.env.E2E_CFG_DIR || "",
  projectRoot: process.env.E2E_PROJECT_ROOT || path.resolve(__dirname, "../.."),
  maxPollAttempts: parseInt(process.env.E2E_MAX_POLL_ATTEMPTS || "30", 10),
  pollBaseMs: parseInt(process.env.E2E_POLL_BASE_MS || "500", 10),
  pollMaxMs: parseInt(process.env.E2E_POLL_MAX_MS || "10000", 10),
};

// ─── Type definitions ─────────────────────────────────────────────────────────

export interface TestAccounts {
  admin: Keypair;
  alice: Keypair;
  bob: Keypair;
  charlie: Keypair;
  issuer: Keypair;
  treasury: Keypair;
}

export interface DeployedContracts {
  contractId: string;
  tokenId: string;
}

export interface IndexerResponse<T = unknown> {
  status: number;
  ok: boolean;
  data: T | null;
  error?: string;
}

// ─── SDK-based transaction submission (replaces shell CLI calls) ───────────────

const _serverCache = new Map<string, StellarRpc.Server>();

function getServer(rpcUrl = TEST_CONFIG.rpcUrl): StellarRpc.Server {
  if (!_serverCache.has(rpcUrl)) {
    _serverCache.set(rpcUrl, new StellarRpc.Server(rpcUrl, { allowHttp: true }));
  }
  return _serverCache.get(rpcUrl)!;
}

/**
 * Submit a contract operation using the SDK: prepare (simulate), sign, submit,
 * and poll for confirmation.
 *
 * @param client   - LinkoraClient (used for prepareTransaction).
 * @param keypair  - Signing keypair for the source account.
 * @param method   - Contract method name (e.g. "set_profile", "create_post").
 * @param args     - ScVal-encoded arguments for the method.
 * @param options  - Optional retry config.
 * @returns The transaction hash.
 */
export async function submitContractTx(
  client: LinkoraClient,
  keypair: Keypair,
  method: string,
  args: xdr.ScVal[],
  options: { maxRetries?: number; pollIntervalMs?: number } = {}
): Promise<string> {
  const server = getServer();
  const maxRetries = options.maxRetries ?? 5;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;

  // 1. Fetch the account fresh on every attempt (see retry loop below).
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const accountData = await server.getAccount(keypair.publicKey());
      const sourceAccount = new Account(keypair.publicKey(), String(accountData.sequence));
      const tx = await client.prepareTransaction(method, sourceAccount, ...args);
      tx.sign(keypair);
      const sendResult = await server.sendTransaction(tx);

      if (sendResult.status === "PENDING" || sendResult.status === "TRY_AGAIN_LATER") {
        // 5. Poll for confirmation
        const hash = sendResult.hash;
        for (let poll = 0; poll < 30; poll++) {
          const getResult = await server.getTransaction(hash);
          if (getResult.status === "SUCCESS") return hash;
          if (getResult.status === "FAILED") {
            throw new Error(`Transaction ${hash} failed: ${JSON.stringify(getResult)}`);
          }
          await sleep(pollIntervalMs);
        }
        throw new Error(`Transaction ${hash} did not complete after 30 polls`);
      }

      if (sendResult.status === "ERROR") {
        throw new Error(`Transaction error: ${JSON.stringify(sendResult)}`);
      }

      return sendResult.hash;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        await sleep(1000 * Math.pow(2, attempt));
      }
    }
  }

  throw lastError ?? new Error("submitContractTx failed");
}

// ─── ScVal encoding helpers (mirrors SDK's internal helpers) ───────────────────

export function scvAddress(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "address" });
}

export function scvString(value: string): xdr.ScVal {
  return nativeToScVal(value);
}

export function scvU32(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: "u32" });
}

export function scvU64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "u64" });
}

export function scvI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(value, { type: "i128" });
}

export function scvBool(value: boolean): xdr.ScVal {
  return nativeToScVal(value);
}

export function scvBytes(value: Uint8Array): xdr.ScVal {
  return nativeToScVal(value, { type: "bytes" });
}

export function scvSymbol(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: "symbol" });
}

export function scvVoid(): xdr.ScVal {
  return nativeToScVal(null);
}

// ─── Account helpers ──────────────────────────────────────────────────────────

export async function createFundedAccount(
  rpcUrl: string = TEST_CONFIG.rpcUrl,
  friendbotUrl: string = TEST_CONFIG.friendbotUrl
): Promise<Keypair> {
  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();

  const response = await _fetch(`${friendbotUrl}?addr=${publicKey}`, { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fund account ${publicKey}: ${response.status} ${body}`);
  }

  await pollForAccount(rpcUrl, publicKey);
  return keypair;
}

async function pollForAccount(
  rpcUrl: string,
  address: string,
  maxAttempts: number = 10,
  baseDelayMs: number = 200
): Promise<void> {
  const server = getServer(rpcUrl);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await server.getAccount(address);
      return;
    } catch {
      // Not yet visible
    }
    await sleep(Math.min(baseDelayMs * Math.pow(1.5, attempt), 2000));
  }

  throw new Error(`Account ${address} did not become available after ${maxAttempts} attempts`);
}

// ─── Contract deployment helpers (via stellar CLI) ────────────────────────────

export function buildContractWasm(projectRoot: string = TEST_CONFIG.projectRoot): string {
  const contractDir = path.join(projectRoot, "packages/contracts/contracts/linkora-contracts");
  console.log(`[setup] Building contract WASM in ${contractDir}...`);

  const result = spawnSync(
    "cargo",
    ["build", "--target", "wasm32v1-none", "--release", "-p", "linkora-contracts"],
    { cwd: contractDir, stdio: "pipe", timeout: 120_000 }
  );

  if (result.status !== 0) {
    throw new Error(`Contract build failed: ${result.stderr?.toString() || "unknown"}`);
  }

  // cargo places artefacts in the WORKSPACE target dir (packages/contracts/target),
  // not inside the crate directory.
  const wasmPath = path.join(
    projectRoot,
    "packages/contracts/target/wasm32v1-none/release/linkora_contracts.wasm"
  );
  console.log(`[setup] Contract WASM built at ${wasmPath}`);
  return wasmPath;
}

export function deployContract(
  wasmPath: string,
  sourceAccountName: string = "e2e-admin",
  cfgDir: string = TEST_CONFIG.cfgDir,
  rpcUrl: string = TEST_CONFIG.rpcUrl,
  networkPassphrase: string = TEST_CONFIG.networkPassphrase
): string {
  const result = execSync(
    `stellar --config-dir "${cfgDir}" contract deploy --network local ` +
      `--source-account ${sourceAccountName} --wasm "${wasmPath}"`,
    {
      encoding: "utf-8",
      timeout: 120_000,
      env: {
        ...process.env,
        STELLAR_RPC_URL: rpcUrl,
        STELLAR_NETWORK_PASSPHRASE: networkPassphrase,
      },
    }
  );
  const contractId = result.trim();
  console.log(`[setup] Contract deployed: ${contractId}`);
  return contractId;
}

export function deployNativeToken(
  _sourceAccountName: string = "e2e-issuer",
  _cfgDir: string = TEST_CONFIG.cfgDir,
  _rpcUrl: string = TEST_CONFIG.rpcUrl,
  networkPassphrase: string = TEST_CONFIG.networkPassphrase
): string {
  // Modern standalone networks pre-deploy the native asset SAC (deploying it
  // again fails with Error(Storage, ExistingValue)), and its contract ID is
  // deterministic anyway — compute it instead of deploying.
  return Asset.native().contractId(networkPassphrase);
}

export function initializeContract(
  contractId: string,
  adminAddress: string,
  treasuryAddress: string,
  feeBps: number = 0,
  sourceAccountName: string = "e2e-admin",
  cfgDir: string = TEST_CONFIG.cfgDir,
  rpcUrl: string = TEST_CONFIG.rpcUrl,
  networkPassphrase: string = TEST_CONFIG.networkPassphrase
): void {
  execSync(
    `stellar --config-dir "${cfgDir}" contract invoke --network local ` +
      `--source-account ${sourceAccountName} --id "${contractId}" -- ` +
      `initialize --admin "${adminAddress}" --treasury "${treasuryAddress}" --fee-bps ${feeBps}`,
    {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        STELLAR_RPC_URL: rpcUrl,
        STELLAR_NETWORK_PASSPHRASE: networkPassphrase,
      },
    }
  );
  console.log(`[setup] Contract initialized`);
}

/**
 * Invoke a contract method using the stellar CLI (for bootstrap operations only).
 * Test-level contract interactions should use submitContractTx() instead.
 */
export function invokeContract(
  contractId: string,
  sourceAccountName: string,
  methodArgs: string,
  cfgDir: string = TEST_CONFIG.cfgDir,
  rpcUrl: string = TEST_CONFIG.rpcUrl,
  networkPassphrase: string = TEST_CONFIG.networkPassphrase
): string {
  const result = execSync(
    `stellar --config-dir "${cfgDir}" contract invoke --network local ` +
      `--source-account ${sourceAccountName} --id "${contractId}" -- ${methodArgs}`,
    {
      encoding: "utf-8",
      timeout: 30_000,
      env: {
        ...process.env,
        STELLAR_RPC_URL: rpcUrl,
        STELLAR_NETWORK_PASSPHRASE: networkPassphrase,
      },
    }
  );
  return result.trim();
}

/**
 * Create a LinkoraClient for SDK operations.
 */
export function createSdkClient(
  contractId: string = TEST_CONFIG.contractId,
  rpcUrl: string = TEST_CONFIG.rpcUrl,
  networkPassphrase: string = TEST_CONFIG.networkPassphrase
): LinkoraClient {
  return new LinkoraClient({ contractId, rpcUrl, networkPassphrase });
}

// ─── Indexer polling helpers ──────────────────────────────────────────────────

export async function indexerFetch<T = unknown>(
  path: string,
  baseUrl: string = TEST_CONFIG.indexerUrl
): Promise<IndexerResponse<T>> {
  try {
    const response = await _fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const data = response.ok ? ((await response.json()) as T) : null;
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    return { status: 0, ok: false, data: null, error: String(error) };
  }
}

/**
 * Poll the indexer API with exponential backoff until a predicate is met.
 */
export async function pollIndexer<T>(
  path: string,
  predicate: (data: T | null) => boolean,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
  } = {}
): Promise<T | null> {
  const maxAttempts = options.maxAttempts ?? TEST_CONFIG.maxPollAttempts;
  const baseDelayMs = options.baseDelayMs ?? TEST_CONFIG.pollBaseMs;
  const maxDelayMs = options.maxDelayMs ?? TEST_CONFIG.pollMaxMs;
  const label = options.label ?? path;

  let lastData: T | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await indexerFetch<T>(path);
    lastData = response.data;

    if (response.ok && predicate(lastData)) {
      if (attempt > 0) {
        console.log(`  [poll] ${label}: condition met after ${attempt + 1} attempts`);
      }
      return lastData;
    }

    const delay = Math.min(baseDelayMs * Math.pow(1.5, attempt) + Math.random() * 200, maxDelayMs);
    await sleep(delay);
  }

  console.warn(`  [poll] ${label}: condition NOT met after ${maxAttempts} attempts`);
  return lastData;
}

/** Poll the indexer until a profile exists. */
export async function pollForProfile(address: string): Promise<IndexerResponse["data"]> {
  return pollIndexer(`/api/profiles/${address}`, (data) => data !== null, {
    label: `profile ${address}`,
  });
}

/** Poll the indexer until a post exists. */
export async function pollForPost(postId: string | number): Promise<IndexerResponse["data"]> {
  return pollIndexer(`/api/posts/${postId}`, (data) => data !== null, { label: `post ${postId}` });
}

/**
 * Poll contract state via SDK simulation until a predicate is met.
 * Used instead of hardcoded sleep() after on-chain actions.
 */
export async function pollContractState<T>(
  fn: () => Promise<T>,
  predicate: (data: T) => boolean,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    label?: string;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 30;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const label = options.label ?? "contract-state";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const data = await fn();
    if (predicate(data)) {
      if (attempt > 0)
        console.log(`  [poll] ${label}: condition met after ${attempt + 1} attempts`);
      return data;
    }
    await sleep(Math.min(baseDelayMs * Math.pow(1.5, attempt), 5000));
  }

  throw new Error(`${label}: condition not met after ${maxAttempts} attempts`);
}

// ─── Contract state read helpers ──────────────────────────────────────────────

export async function getContractProfile(
  address: string,
  contractId: string = TEST_CONFIG.contractId
): Promise<{ address: string; username: string; creator_token: string } | null> {
  return createSdkClient(contractId).getProfile(address);
}

export async function getContractPost(
  postId: number | bigint,
  contractId: string = TEST_CONFIG.contractId
): Promise<{
  id: bigint;
  author: string;
  content: string;
  tip_total: bigint;
  like_count: bigint;
} | null> {
  return createSdkClient(contractId).getPost(postId);
}

// ─── Cleanup helpers ──────────────────────────────────────────────────────────

export function cleanupIdentities(names: string[], cfgDir: string = TEST_CONFIG.cfgDir): void {
  if (!cfgDir) return;
  for (const name of names) {
    try {
      execSync(`stellar --config-dir "${cfgDir}" keys rm "${name}"`, {
        encoding: "utf-8",
        timeout: 5_000,
      });
    } catch {
      // Best-effort
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retry<T>(
  fn: () => Promise<T>,
  predicate: (result: T) => boolean,
  options: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? TEST_CONFIG.maxPollAttempts;
  const baseDelayMs = options.baseDelayMs ?? TEST_CONFIG.pollBaseMs;
  const label = options.label ?? "retry";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fn();
    if (predicate(result)) return result;
    await sleep(Math.min(baseDelayMs * Math.pow(1.5, attempt), 5000));
  }
  throw new Error(`${label}: condition not met after ${maxAttempts} attempts`);
}

// ─── Bootstrap: Full environment setup ────────────────────────────────────────

export async function bootstrap(): Promise<{
  accounts: TestAccounts;
  contracts: DeployedContracts;
  sdk: LinkoraClient;
}> {
  const projectRoot = TEST_CONFIG.projectRoot;
  const rpcUrl = TEST_CONFIG.rpcUrl;
  const netPhrase = TEST_CONFIG.networkPassphrase;

  const cfgDir = execSync("mktemp -d", { encoding: "utf-8" }).trim();
  TEST_CONFIG.cfgDir = cfgDir;

  // Generate and fund accounts
  console.log("[bootstrap] Generating and funding test accounts...");
  const accountNames = [
    "e2e-admin",
    "e2e-alice",
    "e2e-bob",
    "e2e-charlie",
    "e2e-issuer",
    "e2e-treasury",
  ];

  for (const name of accountNames) {
    execSync(`stellar --config-dir "${cfgDir}" keys generate "${name}" --overwrite`, {
      encoding: "utf-8",
      timeout: 10_000,
    });
  }
  for (const name of accountNames) {
    execSync(`stellar --config-dir "${cfgDir}" keys fund "${name}" --network local`, {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, STELLAR_RPC_URL: rpcUrl, STELLAR_NETWORK_PASSPHRASE: netPhrase },
    });
  }

  const adminAddr = execSync(`stellar --config-dir "${cfgDir}" keys address e2e-admin`, {
    encoding: "utf-8",
  }).trim();
  const treasuryAddr = execSync(`stellar --config-dir "${cfgDir}" keys address e2e-treasury`, {
    encoding: "utf-8",
  }).trim();

  // Build and deploy
  const wasmPath = buildContractWasm(projectRoot);
  const contractId = deployContract(wasmPath, "e2e-admin", cfgDir, rpcUrl, netPhrase);
  TEST_CONFIG.contractId = contractId;

  const tokenId = deployNativeToken("e2e-issuer", cfgDir, rpcUrl, netPhrase);
  TEST_CONFIG.tokenId = tokenId;

  initializeContract(
    contractId,
    adminAddr,
    treasuryAddr,
    0,
    "e2e-admin",
    cfgDir,
    rpcUrl,
    netPhrase
  );

  // The indexer requires CONTRACT_ID but compose started it before any
  // contract existed. Recreate it against this suite's fresh deployment,
  // starting the stream near the chain tip (ledger retention would reject a
  // startLedger below the RPC's oldest retained ledger).
  console.log("[bootstrap] Restarting indexer with deployed contract...");
  const composeFile = path.join(projectRoot, "tests/integration/docker-compose.test.yml");
  const { sequence: latestLedger } = await getServer().getLatestLedger();
  const startLedger = Math.max(2, latestLedger - 2);
  execSync(
    `docker compose -p linkora-e2e -f "${composeFile}" up -d --no-deps --force-recreate indexer`,
    {
      encoding: "utf-8",
      timeout: 180_000,
      env: {
        ...process.env,
        CONTRACT_ID: contractId,
        E2E_START_LEDGER: String(startLedger),
      },
    }
  );

  // Wait for indexer
  console.log("[bootstrap] Waiting for indexer to be ready...");
  await retry(
    () => indexerFetch("/health/ready"),
    (r) => r.ok && r.status === 200,
    { maxAttempts: 60, baseDelayMs: 1000, label: "indexer ready" }
  );
  console.log("[bootstrap] Indexer is ready.");

  const sdk = createSdkClient(contractId, rpcUrl, netPhrase);

  // Load Keypairs via the CLI: modern stellar-cli stores identities as TOML
  // seed-phrase files, so let it derive the secret key for us.
  function loadKeypair(name: string): Keypair {
    const secret = execSync(`stellar --config-dir "${cfgDir}" keys secret "${name}"`, {
      encoding: "utf-8",
    }).trim();
    if (!secret.startsWith("S")) throw new Error(`No secret key found for ${name}`);
    return Keypair.fromSecret(secret);
  }

  const accounts: TestAccounts = {
    admin: loadKeypair("e2e-admin"),
    alice: loadKeypair("e2e-alice"),
    bob: loadKeypair("e2e-bob"),
    charlie: loadKeypair("e2e-charlie"),
    issuer: loadKeypair("e2e-issuer"),
    treasury: loadKeypair("e2e-treasury"),
  };

  console.log("[bootstrap] Bootstrap complete.");
  return { accounts, contracts: { contractId, tokenId }, sdk };
}

export async function teardown(cfgDir?: string): Promise<void> {
  const dir = cfgDir || TEST_CONFIG.cfgDir;
  if (!dir) return;
  const names = ["e2e-admin", "e2e-alice", "e2e-bob", "e2e-charlie", "e2e-issuer", "e2e-treasury"];
  cleanupIdentities(names, dir);
  try {
    execSync(`rm -rf "${dir}"`, { encoding: "utf-8", timeout: 5_000 });
  } catch {
    // Best-effort
  }
}

// ─── DM Relay auth helper (matches relay's verifyMessageAuth) ────────────────

/**
 * Create an auth signature for the DM relay's POST /messages endpoint.
 * The relay's AuthService.verifyMessageAuth expects:
 *   signature = Ed25519_sign(sha256(to + ":" + nonce + ":" + timestamp))
 */
export function createRelayMessageSignature(
  keypair: Keypair,
  recipient: string,
  nonce: number,
  timestamp: number
): string {
  const authMessage = `${recipient}:${nonce}:${timestamp}`;
  const hash = sha256(new TextEncoder().encode(authMessage));
  const signature = keypair.sign(Buffer.from(hash));
  return Buffer.from(signature).toString("hex");
}

/**
 * Create an address ownership signature for WebSocket auth.
 * The relay's AuthService.verifyAddressOwnership expects:
 *   challenge = address + ":" + timestamp
 *   signature = Ed25519_sign(sha256(challenge))
 */
export function createAddressOwnershipSignature(
  keypair: Keypair,
  address: string,
  timestamp: number
): string {
  const challenge = `${address}:${timestamp}`;
  const hash = sha256(new TextEncoder().encode(challenge));
  const signature = keypair.sign(Buffer.from(hash));
  return Buffer.from(signature).toString("hex");
}
