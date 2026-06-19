"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { StepTokenDetails, TokenFormValues } from "./StepTokenDetails";
import { StepFeeReview } from "./StepFeeReview";
import { StepDeploy } from "./StepDeploy";
import { StepSuccess } from "./StepSuccess";
import { WizardProgress } from "./WizardProgress";
import { getLinkoraClient } from "@/lib/linkoraClient";

export interface WizardProps {
  deployerAddress: string;
}

type WizardStep = 1 | 2 | 3 | 4;

interface WizardState {
  step: WizardStep;
  tokenForm: TokenFormValues | null;
  estimatedFee: string | null;
  deployedTokenAddress: string | null;
  deployError: string | null;
}

type WizardAction =
  | { type: "NEXT_FROM_DETAILS"; payload: TokenFormValues }
  | { type: "FEE_LOADED"; payload: string }
  | { type: "BACK_TO_DETAILS" }
  | { type: "PROCEED_TO_DEPLOY" }
  | { type: "DEPLOY_SUCCESS"; payload: string }
  | { type: "DEPLOY_ERROR"; payload: string }
  | { type: "RETRY_DEPLOY" };

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "NEXT_FROM_DETAILS":
      return { ...state, step: 2, tokenForm: action.payload };
    case "FEE_LOADED":
      return { ...state, estimatedFee: action.payload };
    case "BACK_TO_DETAILS":
      return { ...state, step: 1 };
    case "PROCEED_TO_DEPLOY":
      return { ...state, step: 3 };
    case "DEPLOY_SUCCESS":
      return { ...state, step: 4, deployedTokenAddress: action.payload, deployError: null };
    case "DEPLOY_ERROR":
      return { ...state, deployError: action.payload };
    case "RETRY_DEPLOY":
      return { ...state, deployError: null };
    default:
      return state;
  }
}

const STEPS = ["Token Details", "Review Fees", "Deploy", "Success"];

export function CreatorTokenWizard({ deployerAddress }: WizardProps) {
  const router = useRouter();

  const [state, dispatch] = useReducer(reducer, {
    step: 1,
    tokenForm: null,
    estimatedFee: null,
    deployedTokenAddress: null,
    deployError: null,
  });

  // Guard: if user already has a creator_token, redirect to profile
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getLinkoraClient();
        const profile = await client.getProfile(deployerAddress);
        if (
          !cancelled &&
          profile &&
          profile.creator_token &&
          profile.creator_token !== deployerAddress
        ) {
          router.replace(`/profile/${deployerAddress}`);
        }
      } catch {
        // Network error — proceed to wizard
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deployerAddress, router]);

  const handleDetailsSubmit = useCallback((values: TokenFormValues) => {
    dispatch({ type: "NEXT_FROM_DETAILS", payload: values });
  }, []);

  const handleFeeLoaded = useCallback((fee: string) => {
    dispatch({ type: "FEE_LOADED", payload: fee });
  }, []);

  const handleDeploySuccess = useCallback((tokenAddress: string) => {
    dispatch({ type: "DEPLOY_SUCCESS", payload: tokenAddress });
  }, []);

  const handleDeployError = useCallback((error: string) => {
    dispatch({ type: "DEPLOY_ERROR", payload: error });
  }, []);

  const handleRetry = useCallback(() => {
    dispatch({ type: "RETRY_DEPLOY" });
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-extrabold tracking-tight mb-2">
            Launch your <span className="text-violet-500">Creator Token</span>
          </h1>
          <p className="text-gray-500 text-sm">
            Deploy a SEP-41 token on Stellar and register it with your Linkora profile.
          </p>
        </div>

        <WizardProgress steps={STEPS} currentStep={state.step} />

        <div className="bg-[var(--muted,#f9f9f9)] border border-gray-200 rounded-2xl p-8 shadow-lg mt-6">
          {state.step === 1 && (
            <StepTokenDetails
              deployerAddress={deployerAddress}
              onSubmit={handleDetailsSubmit}
              initialValues={state.tokenForm ?? undefined}
            />
          )}

          {state.step === 2 && state.tokenForm && (
            <StepFeeReview
              deployerAddress={deployerAddress}
              tokenForm={state.tokenForm}
              onFeeLoaded={handleFeeLoaded}
              estimatedFee={state.estimatedFee}
              onBack={() => dispatch({ type: "BACK_TO_DETAILS" })}
              onProceed={() => dispatch({ type: "PROCEED_TO_DEPLOY" })}
            />
          )}

          {state.step === 3 && state.tokenForm && (
            <StepDeploy
              deployerAddress={deployerAddress}
              tokenForm={state.tokenForm}
              onSuccess={handleDeploySuccess}
              onError={handleDeployError}
              error={state.deployError}
              onRetry={handleRetry}
            />
          )}

          {state.step === 4 && state.deployedTokenAddress && (
            <StepSuccess
              tokenAddress={state.deployedTokenAddress}
              deployerAddress={deployerAddress}
            />
          )}
        </div>
      </div>
    </div>
  );
}
