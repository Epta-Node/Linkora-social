# Mobile and SDK delivery foundations

## EAS build delivery

Preview builds should run for pull requests and production builds should run
only from `main`. EAS credentials, store-submission credentials, Telegram
tokens, and Expo access tokens must be stored as repository secrets and never
be printed by the workflow. Contributors should validate build configuration
locally before enabling a production submission step.

## Push notifications

Register an Expo token only after wallet context is available, then associate
it with the active address through the indexer. Notification payloads should
use stable event types (`tip_received`, `new_follower`, `post_liked`, and
`governance_vote`) and deep-link only to public identifiers. A token refresh
or logout must deregister the previous association.

## Transaction queue priority

Clients should classify deadline-sensitive governance and session actions as
urgent, normal social actions as normal, and maintenance work as background.
Queue telemetry should expose lane depth without publishing transaction
payloads or signer data. Priority changes must preserve FIFO order within the
same lane.
