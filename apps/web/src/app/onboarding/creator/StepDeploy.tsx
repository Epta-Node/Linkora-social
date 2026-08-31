"use client";

import { useState } from "react";
import type { TokenParams } from "./CreatorTokenWizard";

interface Props {
  address: string;
  tokenParams: TokenParams;
  onDeployed: (tokenAddress: string) => void;
  onBack: () => void;
}

type DeployStatus = "idle" | "deploying_token" | "registering_profile" | "done" | "error";

const STATUS_LABELS: Record<DeployStatus, string> = {
  idle: "Ready to deploy",
  deploying_token: "Deploying token…",
  registering_profile: "Registering profile…",
  done: "Done",
  error: "Something went wrong",
};

export function StepDeploy({ address, tokenParams, onDeployed, onBack }: Props) {
  const [status, setStatus] = useState<DeployStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);

  async function handleDeploy() {
    if (!username.trim()) {
      setUsernameError("Username is required before deploying.");
      return;
    }
    setUsernameError(null);
    setStatus("deploying_token");
    setErrorMsg(null);

    try {
      // Dynamic imports keep wallet/SDK code out of the server bundle.
      const { signTransaction, isConnected } = await import("@stellar/freighter-api");
      const { LinkoraClient } = await import("linkora-sdk");
      const { rpc: rpcModule, Transaction } = await import("@stellar/stellar-sdk");

      const connected = await isConnected();
      if (!connected) throw new Error("Freighter wallet is not connected.");

      const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";
      const networkPassphrase =
        process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
      const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
      const factoryId = process.env.NEXT_PUBLIC_TOKEN_FACTORY_ID;

      if (!factoryId) throw new Error("NEXT_PUBLIC_TOKEN_FACTORY_ID is not configured.");

      const client = new LinkoraClient({ contractId, rpcUrl, tokenFactoryId: factoryId });
      const server = new rpcModule.Server(rpcUrl);

      // ── Step 1: simulate to learn the deterministic token address ─────────
      const tokenAddress = await client.simulateDeployCreatorToken({
        deployer: address,
        name: tokenParams.name,
        symbol: tokenParams.symbol,
        decimals: tokenParams.decimals,
        initialSupply: tokenParams.initialSupply,
      });
      if (!tokenAddress) throw new Error("Could not determine token address from simulation.");

      // ── Step 1b: build, sign and submit deploy_creator_token ─────────────
      const deployXdr = client.deployCreatorToken({
        deployer: address,
        name: tokenParams.name,
        symbol: tokenParams.symbol,
        decimals: tokenParams.decimals,
        initialSupply: tokenParams.initialSupply,
      });

      // Freighter v2 signTransaction returns a plain string (signed XDR).
      const signedDeployXdr = await signTransaction(deployXdr, {
        network: "TESTNET",
        accountToSign: address,
      });

      const deployTx = new Transaction(signedDeployXdr, networkPassphrase);
      const deployResult = await server.sendTransaction(deployTx);

      // sendTransaction status is PENDING | DUPLICATE | TRY_AGAIN_LATER | ERROR
      if (deployResult.status === "ERROR" || deployResult.status === "DUPLICATE") {
        throw new Error(`Deploy transaction rejected: ${deployResult.status}`);
      }

      // Poll until confirmed (status transitions from PENDING).
      await waitForConfirmation(server, deployResult.hash);

      // ── Step 2: build, sign and submit set_profile ────────────────────────
      setStatus("registering_profile");

      const profileXdr = client.setProfile(address, username.trim(), tokenAddress);
      const signedProfileXdr = await signTransaction(profileXdr, {
        network: "TESTNET",
        accountToSign: address,
      });

      const profileTx = new Transaction(signedProfileXdr, networkPassphrase);
      const profileResult = await server.sendTransaction(profileTx);

      if (profileResult.status === "ERROR" || profileResult.status === "DUPLICATE") {
        throw new Error(`Profile registration rejected: ${profileResult.status}`);
      }

      await waitForConfirmation(server, profileResult.hash);

      setStatus("done");
      onDeployed(tokenAddress);
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  }

  const isRunning = status === "deploying_token" || status === "registering_profile";

  return (
    <div className="flex flex-col gap-6" data-testid="step-deploy">
      <div>
        <h2 className="text-xl font-bold mb-1">Sign and deploy</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Two transactions will be submitted in sequence via Freighter.
        </p>
      </div>

      {/* Username input — needed for set_profile */}
      {(status === "idle" || status === "error") && (
        <div>
          <label htmlFor="deploy-username" className="block text-sm font-medium mb-1">
            Linkora username
          </label>
          <input
            id="deploy-username"
            type="text"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setUsernameError(null);
            }}
            placeholder="e.g. alice_stellar"
            aria-required="true"
            aria-invalid={!!usernameError}
            className={[
              "w-full rounded-lg border px-3 py-2 text-sm",
              "bg-[var(--bg-tertiary)] text-[var(--text-primary)]",
              "focus:outline-none focus:ring-2 focus:ring-violet-500",
              usernameError ? "border-red-500" : "border-[var(--border)]",
            ].join(" ")}
            data-testid="deploy-username"
          />
          {usernameError && (
            <p role="alert" className="mt-1 text-xs text-red-400">
              {usernameError}
            </p>
          )}
        </div>
      )}

      {/* Progress */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-3">Progress</p>
        <ProgressStep
          label="Deploy token"
          done={status === "registering_profile" || status === "done"}
          active={status === "deploying_token"}
        />
        <ProgressStep
          label="Register profile"
          done={status === "done"}
          active={status === "registering_profile"}
        />
      </div>

      {status === "error" && errorMsg && (
        <p
          role="alert"
          className="text-sm text-red-400 bg-red-950/30 border border-red-800 rounded-lg px-4 py-3"
          data-testid="deploy-error"
        >
          {errorMsg}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          disabled={isRunning}
          className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-violet-500 hover:text-white transition disabled:opacity-40"
          data-testid="step3-back"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleDeploy}
          disabled={isRunning}
          className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="step3-deploy"
        >
          {isRunning ? STATUS_LABELS[status] : "Sign with Freighter"}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForConfirmation(
  server: { getTransaction: (hash: string) => Promise<{ status: string }> },
  hash: string,
  maxAttempts = 20,
  intervalMs = 3000
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tx = await server.getTransaction(hash);
    if (tx.status === "SUCCESS") return;
    if (tx.status === "FAILED") throw new Error(`Transaction ${hash} failed on-chain.`);
  }
  throw new Error(`Transaction ${hash} timed out waiting for confirmation.`);
}

function ProgressStep({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[var(--border)] last:border-0">
      <span
        className={[
          "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0",
          done
            ? "bg-green-500 text-white"
            : active
              ? "bg-violet-500 text-white animate-pulse"
              : "bg-[var(--border)] text-[var(--text-muted)]",
        ].join(" ")}
        aria-hidden="true"
      >
        {done ? "✓" : "·"}
      </span>
      <span
        className={
          done
            ? "line-through text-[var(--text-muted)]"
            : active
              ? "text-white font-medium"
              : "text-[var(--text-muted)]"
        }
      >
        {label}
      </span>
      {active && (
        <span className="ml-auto text-xs text-violet-400 animate-pulse">
          Waiting for signature…
        </span>
      )}
    </div>
  );
}
