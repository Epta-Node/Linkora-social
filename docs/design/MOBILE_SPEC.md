# Mobile UI specification

This document specifies the Expo / React Native mobile experience. Route names refer to
[`apps/mobile/app`](../../apps/mobile/app). Shared visual values come from the mobile
[`theme tokens`](../../apps/mobile/theme/tokens.ts); see the
[component inventory](./COMPONENT_INVENTORY.md) for the wider design system.

## Screen inventory and navigation

The root stack contains the tab navigator and pushes detail screens above it. DM screens
are stack screens, not an additional bottom tab. Preserve the native back button,
Android system Back, and iOS swipe-back behavior.

| Screen                                        | Route                                                                                      | Status                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| Wallet connection                             | `/connect`                                                                                 | Implemented                            |
| Feed, Explore, Pools, Profile, Mini Apps      | `/(tabs)/feed`, `/(tabs)/explore`, `/(tabs)/pools`, `/(tabs)/profile`, `/(tabs)/mini-apps` | Implemented tabs                       |
| Post detail / composer                        | `/post/[id]`, `/post/new`                                                                  | Implemented                            |
| Profile detail / edit / relationships         | `/profile/[address]`, `/profile/edit`, `/profile/followers`, `/profile/following`          | Implemented                            |
| Pool detail / administrators                  | `/pools/[id]`, `/pools/[id]/admins`                                                        | Implemented                            |
| Mini app / post confirmation                  | `/mini-app/[id]`, `/mini-app/create-post`                                                  | Implemented                            |
| Settings / blocked accounts                   | `/settings`, `/settings/blocked`                                                           | Implemented                            |
| Wallet QR / scanner                           | `/wallet/qr`, `/wallet/scan`                                                               | Implemented                            |
| [DM conversation list](#dm-conversation-list) | `/dm` (`dm/index`)                                                                         | Implemented baseline                   |
| [DM thread](#dm-thread)                       | `/dm/[address]`                                                                            | Implemented baseline                   |
| [DM key management](#dm-key-management)       | Proposed `/settings/dm-keys`                                                               | Design target; no standalone route yet |

The DM requirements below are acceptance targets, including gaps in the current screens.
The current thread imports [`utils/mockDm.ts`](../../apps/mobile/utils/mockDm.ts): keys
are stored with Expo SecureStore, but peer-key discovery and message delivery use local
prototype state. A successful prototype send or key generation does **not** establish
production relay delivery or an on-chain key publication. Do not label it as such.

## Shared DM layout and behavior

- Use safe-area insets, `spacing.md` horizontal padding, and theme surface/text/semantic
  colors in both appearances. Verify contrast for the actual foreground/background pair.
- Conversation rows have a minimum height of 76 logical pixels and a 44-pixel avatar.
  Message bubbles occupy at most 80% of the available width and expand vertically.
- Keep the composer above the software keyboard and bottom safe area. At large font sizes
  or in landscape, the header, status text, and controls must wrap without covering content.
- A connected wallet is required. Show “Connect a wallet” with a connection action when
  disconnected. After connecting, return to the intended DM screen. On account change,
  clear the previous account's visible messages, draft, and key details before reloading.
- Show cached content immediately when available. Distinguish the first load, refresh,
  offline cache, and a successful empty response; a network failure must not look empty.
- Keep drafts in memory during recoverable errors and key-setup navigation. Do not silently
  add drafts to persistent storage or send them after account/network changes.
- Use explicit text for status and recovery. Never expose private keys, message plaintext,
  or raw server exceptions in toasts, logs, analytics, or push previews.

## DM conversation list

**Entry:** `/dm`; returning from a thread restores the list position. Selecting a row
opens `/dm/[address]` using the full peer address, not the truncated display label.

### Components

| Component            | Content and interaction                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack header         | “Messages”, native Back, and a labeled “Message keys” action linking to key management when that route is available.                                                                             |
| Conversation list    | Virtualized list keyed by `conversationId`, ordered by latest message, with pull-to-refresh and an equivalent visible Refresh action.                                                            |
| Conversation row     | Avatar or fallback initial; peer display name when available, otherwise shortened address; one-line local message preview; last-message time; unread count. Preserve access to the full address. |
| Unread badge         | Show a count only above zero; use both text and visual emphasis. Opening the thread updates the local read watermark after reconciliation. It is not a remote read receipt.                      |
| Privacy fallback     | Show “Encrypted message” when a preview cannot be decrypted. Never display ciphertext as preview text.                                                                                           |
| State panel / banner | Reuse the mobile [`EmptyState` and `ErrorState`](../../apps/mobile/components/states/index.ts). A refresh error with cached rows uses a banner, leaving rows usable.                             |

The current data source is `getDmConversationSummaries(wallet.address)` in
[`db.ts`](../../apps/mobile/utils/db.ts). Its summary provides the peer, last message,
and unread count. Search, presence, and remote read receipts are outside this screen's
current contract.

### States and recovery

| State                      | Presentation                                                                    | Available action / transition                                                 |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Loading, no cache          | Three noninteractive row skeletons and “Loading conversations”.                 | Keep Back available; replace only after data or an error arrives.             |
| Refreshing                 | Keep existing rows and show a refresh indicator.                                | Prevent duplicate refresh requests; preserve list position.                   |
| Empty                      | “No conversations” / “Your encrypted conversations will appear here.”           | Explain that opening a person's DM thread starts a conversation; retain Back. |
| Loaded                     | Rows with previews and local unread counts.                                     | Open thread; refresh summaries on return.                                     |
| Error, no cache            | “Couldn't load conversations” with a concise reason.                            | Retry the database initialization and summary query; offer Back.              |
| Error with cache / offline | Cached rows plus “Offline — showing saved conversations” or “Couldn't refresh”. | Read cached threads; Refresh when connected. Do not erase rows.               |
| Wallet disconnected        | Connection state, with no previous account's rows.                              | Connect Wallet, then reload for that address.                                 |

### Accessibility

- Give each row one actionable accessibility element with role `button`, a peer name,
  last-message time, and unread count, for example “Conversation with Alice, 2 unread
  messages, last message today at 10:30”. Use a hint such as “Opens conversation”.
- Make the full peer address available in an accessible details/copy action; do not force
  a screen reader to interpret only an ellipsis. Hide decorative avatars from traversal.
- Announce load completion and refresh failures once. Skeletons must not create fake rows
  in the accessibility tree. Keep focus on the selected row when returning from a thread.

## DM thread

**Entry:** `/dm/[address]`; the address identifies the other participant. Validate the
recipient before starting key lookup or sending. Missing or invalid addresses show an
error with Back, not a usable composer.

### Components

| Component                        | Content and interaction                                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Header                           | Back, peer name/address, accessible peer details, and a “Message keys” action when key management is available.                                                                                              |
| Encryption / connectivity banner | Explain local key setup, missing peer key, or offline status. Show encryption readiness only after the required keys are available.                                                                          |
| Message history                  | Virtualized chronological messages; outgoing aligned to the end and incoming to the start. Each bubble shows content, local timestamp, and outgoing send status. Preserve scroll position on reconciliation. |
| Decryption placeholder           | “Unable to decrypt this message” in place of unreadable content. Keep other messages accessible and offer key-setup help.                                                                                    |
| Typing indicator                 | Transient “[Peer] is typing” when an actual event is received; expires after five seconds without another event. Do not treat it as delivery confirmation.                                                   |
| Composer                         | Labeled multiline “Message” input, placeholder “Type a message…”, 500-character limit, counter near the limit, and Send. Disable Send for whitespace-only input or while the current send is in progress.    |
| Send status / recovery           | Per-message “Sending”, “Sent”, or “Failed to send” text. Only label a row “Sent” after reconciliation confirms it; never imply “Delivered” or “Read”.                                                        |

The existing [`thread`](../../apps/mobile/app/dm/[address].tsx) uses
[`sendDmMessageWithOutbox` and `reconcileDmThread`](../../apps/mobile/utils/sync.ts).
The database statuses are `pending`, `synced`, and `failed`. A successful send call leaves
the outbox row pending until reconciliation merges the confirmed copy. Reconnection
reconciles history before advancing the local read watermark.

### States and recovery

| State                     | Presentation                                                             | Available action / transition                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial loading           | “Loading messages” and history placeholders; retain header.              | Disable Send until keys/service are ready. Cached history remains visible if available.                                                                             |
| Empty, ready              | “No messages yet” / “Start a conversation by sending the first message”. | Composer enabled when both participants' keys are ready.                                                                                                            |
| Local keys missing        | “Enable Direct Messages” explaining local encryption keys.               | Generate Keys opens the setup flow; Cancel returns without generating or sending.                                                                                   |
| Peer key missing          | “[Peer] hasn't set up encrypted messaging yet”.                          | Preserve the draft; recheck the peer key explicitly. Create no outbox row and send no ciphertext.                                                                   |
| Sending / pending         | Keep one optimistic message with “Sending”.                              | Prevent duplicate taps; reconcile to `synced` before showing “Sent”.                                                                                                |
| Failed message            | Keep the failed bubble with an actionable explanation.                   | Where supported, retry the same logical outbox message after checking keys, or restore its text to the composer; reconcile ambiguous sends before resending.        |
| Offline / refresh failure | Keep cached history and the draft, show connectivity status.             | Current prototype has no durable automatic retry loop: do not promise background delivery. Explain pending/failed rows and allow explicit recovery after reconnect. |
| Initialization error      | “Couldn't open messaging” with Retry and Back.                           | Retry initialization, including key/service setup; repeating only a history fetch cannot fix missing service state.                                                 |
| Decryption error          | Placeholder for the affected bubble.                                     | Open key help; do not overwrite existing keys or discard the rest of the history.                                                                                   |
| Wallet disconnected       | Connection prompt; hide account-specific content.                        | Reconnect before restoring history for that account.                                                                                                                |

Retries must not create a second bubble for the same logical send. Keep the draft until
the outbox write succeeds; if writing locally fails, restore it. These recovery controls
are design requirements: the current thread displays failures but does not implement a
dedicated per-message retry button or persistent draft store.

### Accessibility

- Read each bubble as sender, message, time, and send status in chronological order,
  independent of visual alignment. Do not use color or alignment as the only sender cue.
- Label the input “Message to [peer]” and Send “Send message”. Expose disabled/busy states
  through `accessibilityState`. Associate the limit and field error with the composer.
- Keep focus in the composer after sending. Announce send failures once without reading
  the private message body. New messages must not steal focus or force scrolling when the
  reader is reviewing older history; provide a labeled “New messages” action instead.
- Typing updates use a polite announcement only when the typing state changes, not on
  every keystroke. Make all actions available without long-press or swipe gestures.

## DM key management

**Design target:** `/settings/dm-keys`, reachable from Settings and DM headers. Today the
thread's “Enable Direct Messages” alert is the only setup entry point; this specification
does not imply that a new route, backup, rotation, or device registry already exists.

The current contract stores one X25519 public key per user through `publish_dm_key` and
`get_dm_key`; publishing another replaces it. The wallet signing key and the DM private
key are different keys. The mobile prototype stores its DM keypair in SecureStore under
an account-specific key; it does not submit `publish_dm_key` to the contract. The
[multi-device design](../dm-relay/MULTI-DEVICE.md) is a proposal, not a shipped capability.

### Components

| Component                  | Content and interaction                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header and account context | “Message keys”, Back, active wallet/address and network context.                                                                                                                                            |
| Key status card            | Separate “On this device” from “Published on network”; show “Unknown” when network verification fails. Never infer publication from the existence of a local key.                                           |
| Public-key details         | Selectable public key/fingerprint with labeled Copy; identify it as a messaging public key. A copied public key must never include the private key.                                                         |
| Setup explanation          | Explain that the private key stays on this device and losing it may make encrypted history unreadable. Connecting the wallet on another device does not restore it.                                         |
| Primary action             | “Generate keys” when absent; “Publish public key” only when production wallet signing/submission is wired. Reuse the stored key when retrying publication.                                                  |
| Transaction status         | For production publication: Awaiting signature, Submitting, Confirmed, or Failed, with transaction reference and an explicit retry/cancel path.                                                             |
| Replacement confirmation   | A future “Replace message key” action must explain the effects on other devices and older history, with Cancel as the safe default. Keep it unavailable until secure key retention/recovery is implemented. |

Do not add private-key reveal/copy, automatic regeneration, backup/export, revocation, or
multi-device sync controls without a separate implemented and reviewed key-lifecycle flow.

### States and recovery

| State                           | Presentation                                                                | Available action / transition                                                                         |
| ------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Loading                         | “Checking message keys”; key actions busy.                                  | Read SecureStore and, in production, query the published public key.                                  |
| Empty / not enabled             | Explain encryption and device-only storage.                                 | Generate Keys after explicit user action; Cancel returns to the originating screen.                   |
| Generating / storing            | “Creating message keys”; prevent repeat generation.                         | Continue only after secure storage succeeds. A storage error must not publish an unpersisted key.     |
| Local only                      | “Saved on this device; not published” or “Publication not verified”.        | Retain the key; offer publication only with an implemented production signer.                         |
| Awaiting signature / submitting | Show the current transaction phase.                                         | Cancellation keeps the local key; a timeout requires checking transaction status before resubmission. |
| Ready                           | Local and verified published public keys match.                             | Copy public details, return to the thread; sending still requires the peer's key.                     |
| Key mismatch / another device   | Explain that the network key differs from this device's key.                | Preserve both the local key and draft; show recovery guidance. Do not replace automatically.          |
| Storage / publication error     | Explain which step failed, without raw key material.                        | Retry the failed step using the same locally stored key, or Cancel.                                   |
| Offline                         | Local status stays visible; published status is unknown/stale.              | Disable network publication and recheck once online.                                                  |
| Local key lost                  | Explain that wallet reconnection cannot recover the missing DM private key. | Do not promise old-history recovery; require an explicit replacement decision.                        |

### Accessibility

- Expose the status card as a readable heading and summary. Public keys need selectable,
  wrapping text and a short, named Copy action; announce “Public key copied” once.
- Confirmations identify their purpose, contain focus while open, support platform
  dismissal, and restore focus to the invoking control. Read the replacement consequence
  before the destructive action; distinguish Cancel from Confirm without relying on color.
- Announce generation/publication state changes politely; cancellation is not an error.
  Focus the error summary after a failed action while keeping Retry and Back reachable.

## Accessibility acceptance checks

For all three screens, verify on iOS VoiceOver and Android TalkBack:

- Every button has a name, role, state, and at least a 48-by-48 logical-pixel target;
  focus order follows header, status, content, then composer/actions. Hardware keyboard
  users can reach and activate every control with visible focus.
- Body text reaches 4.5:1 contrast; large text and essential non-text controls reach 3:1.
  Unread, error, encryption, and send states have text equivalents in both themes.
- System font scaling to 200% preserves readable messages, addresses, counters, and
  actions without clipped text or horizontal scrolling. Test narrow screens and landscape.
- Reduced motion disables skeleton shimmer and nonessential transitions. Loading and
  refresh states have a single spoken status rather than repeated spinner announcements.
- Verify disconnected, empty, first-load failure, cached refresh failure, offline reconnect,
  missing peer key, failed send, and denied secure-storage access. Check that recovery
  preserves the draft and that changing wallets never exposes the previous account's data.
