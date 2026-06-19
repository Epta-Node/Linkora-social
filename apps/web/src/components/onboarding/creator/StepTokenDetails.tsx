"use client";

import { useState, FormEvent } from "react";
import { TokenPreviewCard } from "./TokenPreviewCard";
import { FieldError } from "@/components/forms/FieldError";

export interface TokenFormValues {
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
}

interface Props {
  deployerAddress: string;
  onSubmit: (values: TokenFormValues) => void;
  initialValues?: Partial<TokenFormValues>;
}

interface FormErrors {
  name?: string;
  symbol?: string;
  decimals?: string;
  initialSupply?: string;
}

function validate(values: TokenFormValues): FormErrors {
  const errs: FormErrors = {};
  if (!values.name.trim()) errs.name = "Token name is required.";
  else if (values.name.trim().length > 64) errs.name = "Token name must be 64 characters or fewer.";

  if (!values.symbol.trim()) errs.symbol = "Symbol is required.";
  else if (values.symbol.trim().length > 12) errs.symbol = "Symbol must be 12 characters or fewer.";
  else if (!/^[A-Z0-9]+$/i.test(values.symbol.trim()))
    errs.symbol = "Symbol must be alphanumeric only.";

  if (values.decimals < 0 || values.decimals > 18)
    errs.decimals = "Decimals must be between 0 and 18.";

  if (values.initialSupply !== "") {
    const n = Number(values.initialSupply);
    if (isNaN(n) || n < 0) errs.initialSupply = "Initial supply must be a non-negative number.";
  }

  return errs;
}

export function StepTokenDetails({ deployerAddress, onSubmit, initialValues = {} }: Props) {
  const [name, setName] = useState(initialValues.name ?? "");
  const [symbol, setSymbol] = useState(initialValues.symbol ?? "");
  const [decimals, setDecimals] = useState(initialValues.decimals ?? 7);
  const [initialSupply, setInitialSupply] = useState(initialValues.initialSupply ?? "");
  const [errors, setErrors] = useState<FormErrors>({});

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values: TokenFormValues = {
      name: name.trim(),
      symbol: symbol.trim().toUpperCase(),
      decimals,
      initialSupply: initialSupply.trim(),
    };
    const errs = validate(values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    onSubmit(values);
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Token Details</h2>
      <p className="text-sm text-gray-500 mb-5">
        Configure your SEP-41 creator token. You'll review fees before signing.
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-label="Token details form"
          className="flex flex-col gap-4"
        >
          {/* Name */}
          <div>
            <label htmlFor="token-name" className="block text-sm font-medium mb-1">
              Token name{" "}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
            </label>
            <input
              id="token-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((p) => ({ ...p, name: undefined }));
              }}
              aria-required="true"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "token-name-error" : undefined}
              placeholder="e.g. Alice Creator Coin"
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${errors.name ? "border-red-500" : "border-gray-300"}`}
            />
            <FieldError id="token-name-error" message={errors.name} />
          </div>

          {/* Symbol */}
          <div>
            <label htmlFor="token-symbol" className="block text-sm font-medium mb-1">
              Symbol{" "}
              <span aria-hidden="true" className="text-red-500">
                *
              </span>
            </label>
            <input
              id="token-symbol"
              type="text"
              value={symbol}
              onChange={(e) => {
                setSymbol(e.target.value.toUpperCase());
                setErrors((p) => ({ ...p, symbol: undefined }));
              }}
              aria-required="true"
              aria-invalid={!!errors.symbol}
              aria-describedby={errors.symbol ? "token-symbol-error" : "token-symbol-hint"}
              placeholder="e.g. ACC"
              maxLength={12}
              className={`w-full rounded-lg border px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-violet-500 ${errors.symbol ? "border-red-500" : "border-gray-300"}`}
            />
            {!errors.symbol && (
              <p id="token-symbol-hint" className="mt-1 text-xs text-gray-400">
                Up to 12 alphanumeric characters.
              </p>
            )}
            <FieldError id="token-symbol-error" message={errors.symbol} />
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
              value={decimals}
              onChange={(e) => {
                setDecimals(Number(e.target.value));
                setErrors((p) => ({ ...p, decimals: undefined }));
              }}
              aria-invalid={!!errors.decimals}
              aria-describedby={errors.decimals ? "token-decimals-error" : "token-decimals-hint"}
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${errors.decimals ? "border-red-500" : "border-gray-300"}`}
            />
            {!errors.decimals && (
              <p id="token-decimals-hint" className="mt-1 text-xs text-gray-400">
                7 is standard for Stellar assets.
              </p>
            )}
            <FieldError id="token-decimals-error" message={errors.decimals} />
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
              value={initialSupply}
              onChange={(e) => {
                setInitialSupply(e.target.value);
                setErrors((p) => ({ ...p, initialSupply: undefined }));
              }}
              aria-invalid={!!errors.initialSupply}
              aria-describedby={errors.initialSupply ? "token-supply-error" : "token-supply-hint"}
              placeholder="e.g. 1000000"
              className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 ${errors.initialSupply ? "border-red-500" : "border-gray-300"}`}
            />
            {!errors.initialSupply && (
              <p id="token-supply-hint" className="mt-1 text-xs text-gray-400">
                Minted to your wallet on deployment. Leave blank for 0.
              </p>
            )}
            <FieldError id="token-supply-error" message={errors.initialSupply} />
          </div>

          <button
            type="submit"
            className="mt-2 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            Review Fees →
          </button>
        </form>

        {/* Live preview */}
        <div className="flex flex-col justify-center">
          <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Preview</p>
          <TokenPreviewCard
            name={name}
            symbol={symbol}
            decimals={decimals}
            initialSupply={initialSupply}
            deployerAddress={deployerAddress}
          />
        </div>
      </div>
    </div>
  );
}
