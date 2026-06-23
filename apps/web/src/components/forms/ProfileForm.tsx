 'use client';

import { useState } from 'react';
import { validateUsername, validateStellarAddress } from '@/lib/validate';
import { FieldError } from './FieldError';
import { useNotification } from '@/components/NotificationContext';
import { normalizeError } from '@/lib/normalizeError';

export interface ProfileFormValues {
  username: string;
  creatorToken: string;
}

interface ProfileFormProps {
  /** Called with validated values on successful submission. */
  onSubmit: (values: ProfileFormValues) => void | Promise<void>;
  initialValues?: Partial<ProfileFormValues>;
  disabled?: boolean;
}

interface FormErrors {
  username?: string;
  creatorToken?: string;
}

export function ProfileForm({ onSubmit, initialValues = {}, disabled = false }: ProfileFormProps) {
  const [username, setUsername] = useState(initialValues.username ?? '');
  const [creatorToken, setCreatorToken] = useState(initialValues.creatorToken ?? '');
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  function validate(): FormErrors {
    const errs: FormErrors = {};
    const usernameResult = validateUsername(username);
    if (!usernameResult.valid) errs.username = usernameResult.error;
    // creatorToken is optional — only validate if provided
    if (creatorToken.trim()) {
      const addrResult = validateStellarAddress(creatorToken);
      if (!addrResult.valid) errs.creatorToken = addrResult.error;
    }
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
    const { addNotification, updateNotification } = useNotification();
    const id = addNotification({ status: 'pending', message: 'Preparing transaction...' });
    try {
      const res = await onSubmit({ username: username.trim(), creatorToken: creatorToken.trim() });
      const txHash = (res && typeof res === 'object' && 'txHash' in res) ? (res as any).txHash : undefined;
      updateNotification(id, { status: 'success', message: 'Transaction confirmed', txHash });
    } catch (err) {
      updateNotification(id, { status: 'error', message: normalizeError(err) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Edit profile" className="flex flex-col gap-4">
      {/* Username */}
      <div>
        <label htmlFor="profile-username" className="block text-sm font-medium mb-1">
          Username <span aria-hidden="true" className="text-red-500">*</span>
        </label>
        <input
          id="profile-username"
          name="username"
          type="text"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
            if (errors.username) setErrors((prev) => ({ ...prev, username: undefined }));
          }}
          disabled={disabled || submitting}
          aria-required="true"
          aria-describedby={errors.username ? 'profile-username-error' : undefined}
          aria-invalid={!!errors.username}
          placeholder="e.g. alice_stellar"
          className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${
            errors.username ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        <FieldError id="profile-username-error" message={errors.username} />
      </div>

      {/* Creator token (Stellar address) */}
      <div>
        <label htmlFor="profile-creator-token" className="block text-sm font-medium mb-1">
          Creator Token Address{' '}
          <span className="text-xs text-gray-500 font-normal">(optional — your SEP-41 token)</span>
        </label>
        <input
          id="profile-creator-token"
          name="creatorToken"
          type="text"
          value={creatorToken}
          onChange={(e) => {
            setCreatorToken(e.target.value);
            if (errors.creatorToken) setErrors((prev) => ({ ...prev, creatorToken: undefined }));
          }}
          disabled={disabled || submitting}
          aria-describedby={errors.creatorToken ? 'profile-creator-token-error' : 'profile-creator-token-hint'}
          aria-invalid={!!errors.creatorToken}
          placeholder="GABC…XYZ"
          className={`w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 ${
            errors.creatorToken ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        {!errors.creatorToken && (
          <p id="profile-creator-token-hint" className="mt-1 text-xs text-gray-500">
            Starts with G or C, 56 characters. Leave blank to use your wallet address.
          </p>
        )}
        <FieldError id="profile-creator-token-error" message={errors.creatorToken} />
      </div>

      <button
        type="submit"
        disabled={disabled || submitting}
        className="px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Saving…' : 'Save Profile'}
      </button>
    </form>
  );
}
