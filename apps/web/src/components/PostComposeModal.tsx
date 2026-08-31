"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  scValToNative,
  rpc as StellarRpc,
  Transaction,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { RichTextComposer } from "./RichTextComposer";

const MAX_CONTENT_LENGTH = 280;
const AMBER_THRESHOLD = 50;
const RED_THRESHOLD = 10;

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const CONTRACT_ID =
  process.env.NEXT_PUBLIC_CONTRACT_ID ?? "CDD6V66I7G2K2TCHWGLD4QIPZ4E47W4T3HLY3W7YJ4NGRRYUDRF6QYLR";

type SubmitStatus = "idle" | "awaiting_signature" | "submitting" | "success" | "error";

interface PostComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  publicKey: string | null;
}

interface PublishState {
  status: SubmitStatus;
  errorMsg: string;
  postId: string | null;
  txHash: string | null;
}

export function PostComposeModal({ isOpen, onClose, publicKey }: PostComposeModalProps) {
  const router = useRouter();
  const [publishState, setPublishState] = useState<PublishState>({
    status: "idle",
    errorMsg: "",
    postId: null,
    txHash: null,
  });

  // Mock users for mentions - in production, this would come from an API
  const mockUsers = [
    { id: "1", username: "alice", displayName: "Alice Johnson" },
    { id: "2", username: "bob", displayName: "Bob Smith" },
    { id: "3", username: "charlie", displayName: "Charlie Davis" },
    { id: "4", username: "diana", displayName: "Diana Prince" },
    { id: "5", username: "evan", displayName: "Evan Wright" },
  ];

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && publishState.status === "idle") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose, publishState.status]);

  const handleSubmit = useCallback(
    async (content: string, attachments?: File[], poll?: any[]) => {
      if (!publicKey) return;

      setPublishState({ status: "awaiting_signature", errorMsg: "", postId: null, txHash: null });

      try {
        const server = new StellarRpc.Server(RPC_URL);
        const account = await server.getAccount(publicKey);

        const contract = new Contract(CONTRACT_ID);
        const op = contract.call(
          "create_post",
          Address.fromString(publicKey).toScVal(),
          nativeToScVal(content, { type: "string" })
        );

        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(op)
          .setTimeout(30)
          .build();

        const simulated = await server.simulateTransaction(tx);
        if (StellarRpc.Api.isSimulationError(simulated)) {
          throw new Error(`Simulation failed: ${simulated.error}`);
        }

        const finalTx = StellarRpc.assembleTransaction(tx, simulated).build();
        const xdrString = finalTx.toXDR();

        const signedXdr = await signTransaction(xdrString, {
          networkPassphrase: NETWORK_PASSPHRASE,
        });

        setPublishState((prev) => ({ ...prev, status: "submitting" }));

        const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
        let sendResponse = await server.sendTransaction(signedTx);

        if (sendResponse.status === "ERROR") {
          throw new Error("Stellar Transaction failed to submit");
        }

        let status: string = sendResponse.status;
        let txResponse = null;
        const startTime = Date.now();

        while (status === "PENDING" && Date.now() - startTime < 30000) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          txResponse = await server.getTransaction(sendResponse.hash);
          status = txResponse.status as string;
        }

        if (status !== "SUCCESS" || !txResponse) {
          throw new Error("Transaction execution timed out or failed");
        }

        const val = (txResponse as any).returnValue;
        const newPostId = val
          ? scValToNative(val).toString()
          : Math.floor(Math.random() * 100000).toString();

        setPublishState({
          status: "success",
          errorMsg: "",
          postId: newPostId,
          txHash: sendResponse.hash,
        });

        setTimeout(() => {
          onClose();
          router.push(`/posts/${newPostId}`);
        }, 1500);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to publish post";
        setPublishState({
          status: "error",
          errorMsg: message,
          postId: null,
          txHash: null,
        });
      }
    },
    [publicKey, onClose, router]
  );

  const handleTryAgain = () => {
    setPublishState({ status: "idle", errorMsg: "", postId: null, txHash: null });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="Compose post">
      <div className="bg-[var(--muted)] border border-[var(--border)] rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-[var(--border)]">
          <button
            type="button"
            onClick={onClose}
            disabled={
              publishState.status === "awaiting_signature" || publishState.status === "submitting"
            }
            className="text-[var(--text-muted)] hover:text-white transition-colors text-lg"
            aria-label="Close compose modal"
          >
            ✕
          </button>
          <h2 className="text-lg font-bold text-white">Compose Post</h2>
          <div className="w-6" />
        </header>

        {/* Form */}
        <div className="p-4 md:p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Author info */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--accent)] flex items-center justify-center text-white font-bold text-sm">
              {publicKey ? publicKey.slice(0, 2).toUpperCase() : "??"}
            </div>
            <span className="text-sm font-semibold text-[var(--text-muted)]">
              {publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : "Not Connected"}
            </span>
          </div>

          {/* Rich Text Composer */}
          <RichTextComposer
            onSubmit={handleSubmit}
            onCancel={onClose}
            placeholder="What's happening on-chain?"
            disabled={publishState.status !== "idle" && publishState.status !== "error"}
            users={mockUsers}
          />

          {/* Status Messages */}
          {publishState.status === "awaiting_signature" && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-500 rounded-xl p-3 text-sm flex items-center gap-2" role="status">
              <span className="animate-pulse" aria-hidden="true">⏳</span>
              <span>Waiting for Freighter wallet signing...</span>
            </div>
          )}

          {publishState.status === "submitting" && (
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-500 rounded-xl p-3 text-sm flex items-center gap-2" role="status">
              <span className="animate-spin" aria-hidden="true">🔄</span>
              <span>Submitting transaction to Stellar blockchain...</span>
            </div>
          )}

          {publishState.status === "success" && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-500 rounded-xl p-3 text-sm flex flex-col gap-2" role="status">
              <div className="flex items-center gap-2">
                <span aria-hidden="true">✅</span>
                <span>Post published successfully! Redirecting...</span>
              </div>
              {publishState.txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${publishState.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-green-400 underline text-xs self-start hover:text-green-300 transition-colors"
                >
                  View on Stellar Expert ↗
                </a>
              )}
            </div>
          )}

          {publishState.status === "error" && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl p-3 text-sm flex flex-col gap-2" role="alert">
              <div className="flex items-center gap-2">
                <span aria-hidden="true">⚠️</span>
                <span className="break-all">{publishState.errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={handleTryAgain}
                className="self-end px-3 py-1 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
