# Credential Verification Limits

`verify_credential` accepts Merkle proofs up to depth 20. This bound keeps the
hashing work and host budget predictable while supporting the protocol's
depth-20 credential trees. Proofs deeper than 20 siblings are rejected before
any nullifier is written.

The nullifier remains persistent for the lifetime of the credential root. It
must not be deleted as a routine cleanup operation: deleting it would allow a
previously accepted proof to be replayed. Any future pruning design must first
introduce an authenticated credential epoch and retain the epoch's replay
boundary on chain.
