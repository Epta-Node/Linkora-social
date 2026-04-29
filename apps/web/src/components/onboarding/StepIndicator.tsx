import type { WalletState } from "@/hooks/useWallet";

const STEPS = [
  { id: "install", label: "Install" },
  { id: "connect", label: "Connect" },
  { id: "fund", label: "Fund" },
  { id: "profile", label: "Profile" },
];

function stepIndex(state: WalletState): number {
  switch (state) {
    case "not_installed": return 0;
    case "not_connected": return 1;
    case "connected_no_profile": return 2; // could be 3 if funded
    case "ready": return 4;
    default: return 0;
  }
}

export function StepIndicator({
  state,
  balance,
}: {
  state: WalletState;
  balance: string | null;
}) {
  // If connected and funded, jump past fund step
  const funded = balance !== null && parseFloat(balance) > 0;
  const current =
    state === "connected_no_profile" && funded ? 3 : stepIndex(state);

  return (
    <div className="flex items-center justify-center gap-0 w-full max-w-sm mx-auto mb-8">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className="flex flex-col items-center flex-1">
              <div
                className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors",
                  done
                    ? "bg-violet-600 border-violet-600 text-white"
                    : active
                    ? "border-violet-500 text-violet-400 bg-transparent"
                    : "border-[var(--border)] text-[var(--text-muted)] bg-transparent",
                ].join(" ")}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={[
                  "text-xs mt-1",
                  active ? "text-violet-400" : done ? "text-violet-500" : "text-[var(--text-muted)]",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={[
                  "h-0.5 flex-1 mb-5 transition-colors",
                  done ? "bg-violet-600" : "bg-[var(--border)]",
                ].join(" ")}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
