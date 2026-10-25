"use client";

import { BadgeCheck } from "lucide-react";
import {
  VERIFICATION_LABEL,
  VERIFICATION_PROVENANCE,
  type VerificationLevel,
} from "@/lib/verification";

export type { VerificationLevel } from "@/lib/verification";

interface VerificationBadgeProps {
  /** Verification level driving the human-readable provenance copy. */
  level?: VerificationLevel;
  /** Account the badge describes, used to make the accessible label unique. */
  subject?: string;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

/**
 * Displays a verified checkmark for accounts that hold an on-chain attestation.
 *
 * Accessibility: the checkmark is rendered with an explicit `aria-label`, so
 * verification is conveyed by more than colour alone. The provenance
 * (e.g. "Identity verified via Stellar attestation") is available as both a
 * native tooltip and screen-reader-only text.
 */
export function VerificationBadge({
  level = "identity",
  subject,
  className = "",
}: VerificationBadgeProps) {
  const provenance = VERIFICATION_PROVENANCE[level];
  const label = subject ? `${subject} — ${VERIFICATION_LABEL[level]}` : VERIFICATION_LABEL[level];

  return (
    <span
      className={`inline-flex shrink-0 items-center align-middle ${className}`.trim()}
      data-testid="verification-badge"
    >
      <BadgeCheck
        role="img"
        aria-label={`${label}. ${provenance}.`}
        // `title` and `data-*` are valid attributes on the rendered <svg>, but
        // lucide's `LucideProps` (Partial<SVGProps>) omits them, so they are
        // spread in rather than written as JSX attributes.
        {...{ title: provenance, "data-verification-level": level }}
        className="h-4 w-4 text-[var(--accent)]"
        strokeWidth={2.25}
      />
      <span className="sr-only">{`${VERIFICATION_LABEL[level]}. ${provenance}.`}</span>
    </span>
  );
}
