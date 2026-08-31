'use client';

import { useState } from 'react';
import { validateAmount, validateStellarAddress } from '@/lib/validate';
import { FieldError } from './FieldError';

export interface TipFormValues {
  tokenAddress: string;
  amount: string;
}

interface TipFormProps {
  postId: string | number;
  onSubmit: (values: TipFormValues) => void | Promise<void>;
  disabled?: boolean;
}

interface FormErrors {
  tokenAddress?: string;
  amount?: string;
}

export function TipForm({ postId, onSubmit, disabled = false }: TipFormProps) {
  const [tokenAddress, setTokenAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    const addrResult = validateStellarAddress(tokenAddress);
    if (!addrResult.valid) errs.tokenAddress = addrResult.error;
    const amtResult = validateAmount(amount);
    if (!amtResult.valid) errs.amount = amtResult.error;
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ tokenAddress: tokenAddress.trim(), amount: amount.trim() });
      setAmount('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={`Tip post ${postId}`}
      className="flex flex-col gap-3"
    >
      {/* Token address */}
      <div>
        <label htmlFor={`tip-token-${postId}`} className="block text-sm font-medium mb-1">
          Token Address <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <input
          id={`tip-token-${postId}`}
          name="tokenAddress"
          type="text"
          value={tokenAddress}
          onChange={(e) => {
            setTokenAddress(e.target.value);
            if (errors.tokenAddress) setErrors((prev) => ({ ...prev, tokenAddress: undefined }));
          }}
          disabled={disabled || submitting}
          aria-required="true"
          aria-describedby={errors.tokenAddress ? `tip-token-error-${postId}` : undefined}
          aria-invalid={!!errors.tokenAddress}
          placeholder="GABC…XYZ"
          className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${
            errors.tokenAddress ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        <FieldError id={`tip-token-error-${postId}`} message={errors.tokenAddress} />
      </div>

      {/* Amount */}
      <div>
        <label htmlFor={`tip-amount-${postId}`} className="block text-sm font-medium mb-1">
          Amount <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <input
          id={`tip-amount-${postId}`}
          name="amount"
          type="number"
          inputMode="decimal"
          min="0.0000001"
          step="any"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            if (errors.amount) setErrors((prev) => ({ ...prev, amount: undefined }));
          }}
          disabled={disabled || submitting}
          aria-required="true"
          aria-describedby={errors.amount ? `tip-amount-error-${postId}` : undefined}
          aria-invalid={!!errors.amount}
          placeholder="0.00"
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${
            errors.amount ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        <FieldError id={`tip-amount-error-${postId}`} message={errors.amount} />
      </div>

      <button
        type="submit"
        disabled={disabled || submitting}
        className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Sending…' : 'Send Tip'}
      </button>
    </form>
  );
}
