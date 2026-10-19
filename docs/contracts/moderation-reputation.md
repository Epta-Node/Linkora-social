# Moderation Reporter Reputation

Reporters have a bounded reputation score in `[-100, 100]`. A new report
captures a weight in basis points derived from that score:

- score `0` starts at `10,000` bps;
- each upheld report increases the score by one;
- each dismissed report decreases it by one;
- the effective weight is clamped to `5,000..15,000` bps.

The weight is stored on the report and is available through `get_report`, so
indexers and moderation tooling can apply the same deterministic weighting.
Reports remain subject to moderator review; there is no automatic deletion or
automatic uphold based only on reporter reputation.
