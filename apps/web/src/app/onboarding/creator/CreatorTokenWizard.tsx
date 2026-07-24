"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { useProfile } from "@/hooks/useProfile";
import { StepTokenDetails } from "./StepTokenDetails";
import { StepReviewFees } from "./StepReviewFees";
import { StepDeploy } from "./StepDeploy";
import { StepSuccess } from "./StepSuccess";
// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenParams {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: bigint;
}

export type WizardStep = 1 | 2 | 3 | 4;

export interface WizardState {
  step: WizardStep;
  tokenParams: TokenParams | null;
  estimatedFee: string | null;
  deployedTokenAddress: string | null;
}

type WizardAction =
  | { type: "SET_TOKEN_PARAMS"; params: TokenParams }
  | { type: "SET_FEE"; fee: string }
  | { type: "SET_DEPLOYED"; address: string }
  | { type: "NEXT" }
  | { type: "BACK" };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_TOKEN_PARAMS":
      return { ...state, tokenParams: action.params };
    case "SET_FEE":
      return { ...state, estimatedFee: action.fee };
    case "SET_DEPLOYED":
      return { ...state, deployedTokenAddress: action.address, step: 4 };
    case "NEXT":
      return { ...state, step: Math.min(state.step + 1, 4) as WizardStep };
    case "BACK":
      return { ...state, step: Math.max(state.step - 1, 1) as WizardStep };
    default:
      return state;
  }
}

const INITIAL_STATE: WizardState = {
  step: 1,
  tokenParams: null,
  estimatedFee: null,
  deployedTokenAddress: null,
};

// ── Wizard Container ──────────────────────────────────────────────────────────

export function CreatorTokenWizard() {
  const { address, connected } = useWallet();
  const { state: profileState } = useProfile(address ?? "");
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Guard: if the user already has a creator token, redirect to their profile.
  useEffect(() => {
    if (typeof window === "undefined" || !address) return;
    const storedCreatorToken = localStorage.getItem(`linkora:creator_token:${address}`);
    if (storedCreatorToken && storedCreatorToken !== address) {
      router.replace(`/profile/${address}`);
      return;
    }

    if (profileState.status === "loading") return;
    if (
      profileState.status === "success" &&
      profileState.data.profile.creator_token &&
      profileState.data.profile.creator_token !== address
    ) {
      router.replace(`/profile/${address}`);
    }
  }, [profileState, address, router]);

  if (!connected || !address) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-[var(--text-muted)] mb-4">
            Connect your wallet to launch a creator token.
          </p>
          <a href="/" className="btn-primary" style={{ width: "auto", display: "inline-flex" }}>
            Go home
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
          Launch Your <span className="text-violet-500">Creator Token</span>
        </h1>
        <p className="text-[var(--text-muted)] max-w-md mx-auto text-sm">
          Deploy a SEP-41 token on Stellar and link it to your Linkora profile.
        </p>
      </div>

      {/* Step indicator */}
      <WizardStepIndicator current={state.step} />

      {/* Step card */}
      <div className="w-full max-w-md bg-[var(--muted)] border border-[var(--border)] rounded-2xl p-8 shadow-xl">
        {state.step === 1 && (
          <StepTokenDetails
            initial={state.tokenParams}
            onNext={(params) => {
              dispatch({ type: "SET_TOKEN_PARAMS", params });
              dispatch({ type: "NEXT" });
            }}
          />
        )}
        {state.step === 2 && state.tokenParams && (
          <StepReviewFees
            address={address}
            tokenParams={state.tokenParams}
            onFeeEstimated={(fee) => dispatch({ type: "SET_FEE", fee })}
            onNext={() => dispatch({ type: "NEXT" })}
            onBack={() => dispatch({ type: "BACK" })}
          />
        )}
        {state.step === 3 && state.tokenParams && (
          <StepDeploy
            address={address}
            tokenParams={state.tokenParams}
            onDeployed={(tokenAddress) => dispatch({ type: "SET_DEPLOYED", address: tokenAddress })}
            onBack={() => dispatch({ type: "BACK" })}
          />
        )}
        {state.step === 4 && state.deployedTokenAddress && (
          <StepSuccess walletAddress={address} tokenAddress={state.deployedTokenAddress} />
        )}
      </div>
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────────────────────

const STEP_LABELS = ["Token details", "Review fees", "Deploy", "Success"];

function WizardStepIndicator({ current }: { current: WizardStep }) {
  return (
    <nav aria-label="Wizard steps" className="flex items-center gap-2 mb-6">
      {STEP_LABELS.map((label, i) => {
        const step = (i + 1) as WizardStep;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              aria-current={active ? "step" : undefined}
              className={[
                "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
                done
                  ? "bg-violet-500 text-white"
                  : active
                    ? "bg-violet-600 text-white ring-2 ring-violet-400 ring-offset-2 ring-offset-[var(--muted)]"
                    : "bg-[var(--border)] text-[var(--text-muted)]",
              ].join(" ")}
            >
              {done ? "✓" : step}
            </div>
            <span
              className={[
                "text-xs hidden sm:inline",
                active ? "text-white font-medium" : "text-[var(--text-muted)]",
              ].join(" ")}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && (
              <div className="w-6 h-px bg-[var(--border)] mx-1" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
