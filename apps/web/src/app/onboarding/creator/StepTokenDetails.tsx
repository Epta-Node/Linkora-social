"use client";

import { useState } from "react";
import type { TokenParams } from "./CreatorTokenWizard";

interface Props {
  initial: TokenParams | null;
  onNext: (params: TokenParams) => void;
}

interface FormErrors {
  name?: string;
  symbol?: string;
  decimals?: string;
  initialSupply?: string;
}

function validate(
  name: string,
  symbol: string,
  decimals: string,
  initialSupply: string
): FormErrors {
  const errs: FormErrors = {};
  if (!name.trim()) errs.name = "Token name is required.";
  else if (name.trim().length > 32) errs.name = "Name must be 32 characters or fewer.";

  if (!symbol.trim()) errs.symbol = "Symbol is required.";
  else if (!/^[A-Z0-9]{1,12}$/.test(symbol.trim()))
    errs.symbol = "Symbol must be 1–12 uppercase letters/digits.";

  const dec = Number(decimals);
  if (Number.isNaN(dec) || !Number.isInteger(dec) || dec < 0 || dec > 18)
    errs.decimals = "Decimals must be an integer between 0 and 18.";

  const supply = Number(initialSupply);
  if (Number.isNaN(supply) || supply < 0)
    errs.initialSupply = "Initial supply must be a non-negative number.";

  return errs;
}

export function StepTokenDetails({ initial, onNext }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [decimals, setDecimals] = useState(String(initial?.decimals ?? 7));
  const [initialSupply, setInitialSupply] = useState(
    initial ? String(initial.initialSupply) : "1000000"
  );
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const errs = validate(name, symbol, decimals, initialSupply);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    onNext({
      name: name.trim(),
      symbol: symbol.trim(),
      decimals: Number(decimals),
      initialSupply: BigInt(initialSupply),
    });
  }

  return (
    <form
      id="step-token-details"
      onSubmit={handleSubmit}
      noValidate
      aria-label="Token details"
      className="flex flex-col gap-5"
    >
      <div>
        <h2 className="text-xl font-bold mb-1">Token details</h2>
        <p className="text-sm text-[var(--text-muted)]">Define your SEP-41 creator token.</p>
      </div>

      {/* Name */}
      <div>
        <label htmlFor="token-name" className="block text-sm font-medium mb-1">
          Token name
        </label>
        <input
          id="token-name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((p) => ({ ...p, name: undefined }));
          }}
          placeholder="e.g. My Creator Coin"
          aria-required="true"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "token-name-err" : undefined}
          className={inputClass(!!errors.name)}
        />
        {errors.name && (
          <p id="token-name-err" role="alert" className="mt-1 text-xs text-red-400">
            {errors.name}
          </p>
        )}
      </div>

      {/* Symbol */}
      <div>
        <label htmlFor="token-symbol" className="block text-sm font-medium mb-1">
          Symbol
        </label>
        <input
          id="token-symbol"
          type="text"
          value={symbol}
          onChange={(e) => {
            setSymbol(e.target.value.toUpperCase());
            setErrors((p) => ({ ...p, symbol: undefined }));
          }}
          placeholder="e.g. MCC"
          maxLength={12}
          aria-required="true"
          aria-invalid={!!errors.symbol}
          aria-describedby={errors.symbol ? "token-symbol-err" : undefined}
          className={inputClass(!!errors.symbol)}
        />
        {errors.symbol && (
          <p id="token-symbol-err" role="alert" className="mt-1 text-xs text-red-400">
            {errors.symbol}
          </p>
        )}
      </div>

      {/* Decimals */}
      <div>
        <label htmlFor="token-decimals" className="block text-sm font-medium mb-1">
          Decimals
        </label>
        <input
          id="token-decimals"
          type="number"
          min={0}
          max={18}
          step={1}
          value={decimals}
          onChange={(e) => {
            setDecimals(e.target.value);
            setErrors((p) => ({ ...p, decimals: undefined }));
          }}
          aria-required="true"
          aria-invalid={!!errors.decimals}
          aria-describedby={errors.decimals ? "token-decimals-err" : "token-decimals-hint"}
          className={inputClass(!!errors.decimals)}
        />
        {!errors.decimals && (
          <p id="token-decimals-hint" className="mt-1 text-xs text-[var(--text-muted)]">
            7 is standard for Stellar tokens
          </p>
        )}
        {errors.decimals && (
          <p id="token-decimals-err" role="alert" className="mt-1 text-xs text-red-400">
            {errors.decimals}
          </p>
        )}
      </div>

      {/* Initial supply */}
      <div>
        <label htmlFor="token-supply" className="block text-sm font-medium mb-1">
          Initial supply
        </label>
        <input
          id="token-supply"
          type="number"
          min={0}
          step={1}
          value={initialSupply}
          onChange={(e) => {
            setInitialSupply(e.target.value);
            setErrors((p) => ({ ...p, initialSupply: undefined }));
          }}
          aria-required="true"
          aria-invalid={!!errors.initialSupply}
          aria-describedby={errors.initialSupply ? "token-supply-err" : undefined}
          className={inputClass(!!errors.initialSupply)}
        />
        {errors.initialSupply && (
          <p id="token-supply-err" role="alert" className="mt-1 text-xs text-red-400">
            {errors.initialSupply}
          </p>
        )}
      </div>

      {/* Live preview */}
      {(name || symbol) && (
        <TokenPreview
          name={name || "—"}
          symbol={symbol || "—"}
          decimals={Number(decimals) || 0}
          supply={initialSupply || "0"}
        />
      )}

      <button type="submit" className="btn-primary mt-2" data-testid="step1-next">
        Next — Review fees
      </button>
    </form>
  );
}

function inputClass(hasError: boolean) {
  return [
    "w-full rounded-lg border px-3 py-2 text-sm bg-[var(--bg-tertiary)] text-[var(--text-primary)]",
    "focus:outline-none focus:ring-2 focus:ring-violet-500",
    hasError ? "border-red-500" : "border-[var(--border)]",
  ].join(" ");
}

function TokenPreview({
  name,
  symbol,
  decimals,
  supply,
}: {
  name: string;
  symbol: string;
  decimals: number;
  supply: string;
}) {
  return (
    <div
      aria-label="Token preview"
      className="rounded-xl border border-violet-700 bg-violet-950/30 p-4 text-sm"
    >
      <p className="text-xs text-violet-400 uppercase tracking-widest mb-2">Preview</p>
      <div className="flex justify-between">
        <span className="font-mono font-bold text-violet-300">{symbol}</span>
        <span className="text-[var(--text-muted)]">{name}</span>
      </div>
      <div className="flex justify-between mt-1 text-xs text-[var(--text-muted)]">
        <span>Decimals: {decimals}</span>
        <span>
          Supply: {Number(supply).toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </span>
      </div>
    </div>
  );
}
