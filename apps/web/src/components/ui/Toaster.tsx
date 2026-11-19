"use client";

import { toast, useToasts, type Toast } from "@/lib/toast";

const STELLAR_EXPERT_BASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE?.includes("Public")
  ? "https://stellar.expert/explorer/public/tx"
  : "https://stellar.expert/explorer/testnet/tx";

const VARIANT_CLASS: Record<Toast["variant"], string> = {
  error: "border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  info: "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
};

function ToastRow({ entry }: { entry: Toast }) {
  return (
    <div
      role={entry.variant === "error" ? "alert" : "status"}
      data-testid={`toast-${entry.variant}`}
      className={`pointer-events-auto flex w-full items-start gap-3 rounded-xl border p-3 shadow-lg backdrop-blur ${VARIANT_CLASS[entry.variant]}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{entry.title}</p>
        {entry.description && <p className="mt-0.5 text-xs opacity-90">{entry.description}</p>}
        {entry.txHash && (
          <a
            href={`${STELLAR_EXPERT_BASE}/${encodeURIComponent(entry.txHash)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 block break-all text-xs underline"
          >
            View transaction: {entry.txHash}
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(entry.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded p-1 text-xs opacity-70 transition-opacity hover:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Renders the global toast queue.
 *
 * Rollback handlers of optimistic mutations push a descriptive error here, so
 * the user learns that the action was reverted instead of silently seeing the
 * UI snap back.
 */
export function Toaster() {
  const toasts = useToasts();

  return (
    <div
      aria-live="assertive"
      aria-atomic="false"
      data-testid="toaster"
      className="pointer-events-none fixed bottom-4 right-4 z-[2000] flex w-[min(92vw,360px)] flex-col gap-2"
    >
      {toasts.map((entry) => (
        <ToastRow key={entry.id} entry={entry} />
      ))}
    </div>
  );
}
