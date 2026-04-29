"use client";

import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { StepIndicator } from "./StepIndicator";
import { NotInstalledState } from "./NotInstalledState";
import { NotConnectedState } from "./NotConnectedState";
import { FundWalletState } from "./FundWalletState";
import { NoProfileState } from "./NoProfileState";

export function OnboardingFlow() {
  const { state, wallet, connect, refresh } = useWallet();
  const [skipFund, setSkipFund] = useState(false);

  const funded = wallet.balance !== null && parseFloat(wallet.balance) > 0;
  const showFund = state === "connected_no_profile" && !funded && !skipFund;

  function renderStep() {
    switch (state) {
      case "loading":
        return <p className="text-[var(--text-muted)] animate-pulse">Detecting wallet…</p>;
      case "not_installed":
        return <NotInstalledState />;
      case "not_connected":
        return <NotConnectedState onConnect={connect} />;
      case "connected_no_profile":
        return showFund ? (
          <FundWalletState
            address={wallet.address!}
            onFunded={() => { setSkipFund(true); refresh(); }}
          />
        ) : (
          <NoProfileState />
        );
      case "ready":
        return null; // caller redirects
    }
  }

  if (state === "ready") return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Hero */}
      <div className="text-center mb-10">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3">
          Welcome to{" "}
          <span className="text-violet-500">Linkora</span>
        </h1>
        <p className="text-[var(--text-muted)] text-lg max-w-md mx-auto">
          A decentralised social layer on Stellar. Connect your wallet to get started.
        </p>
      </div>

      {/* Step indicator — hide on loading */}
      {state !== "loading" && (
        <StepIndicator state={state} balance={wallet.balance} />
      )}

      {/* State card */}
      <div className="w-full max-w-sm bg-[var(--muted)] border border-[var(--border)] rounded-2xl p-8 shadow-xl">
        {renderStep()}
      </div>
    </div>
  );
}
