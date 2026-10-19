/**
 * Thrown when a DM operation needs the recipient's public encryption key but
 * none has been published/verified yet.
 *
 * #1561 — this must fail closed (no encryption, no send) rather than
 * silently falling back to encrypting the message to the sender's own key,
 * which looked like a successful send but left the recipient nothing to
 * decrypt. Kept dependency-free so both the DM transport layer (`sync.ts`)
 * and its implementations (e.g. `mockDm.ts`) can throw/catch the same type
 * without pulling in each other's module graph.
 */
export class UnknownRecipientKeyError extends Error {
  constructor(public readonly address: string) {
    super(`No verified encryption key for ${address}`);
    this.name = "UnknownRecipientKeyError";
  }
}
