# Linkora Component Library

> **Companion document:** [`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md) — full per-component props tables, accessibility notes, and usage snippets.
>
> This README is the high-level overview; the inventory is the exhaustive reference.
>
> **Figma file:** _[Link to published Figma file — to be added when file is published]_
>
> All reusable UI components for the Linkora SocialFi web application.
> This document is the canonical reference for component usage, variants, and design tokens.

---

## Quick links

| Section                               | Contents                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------- |
| [Component inventory](#component-inventory) | Index of every component in `apps/web/src/components/`               |
| [Design tokens](#design-tokens)       | Color, type, spacing, and shadow variables                                 |
| [Atoms](#atoms)                       | Button, Input, Textarea, Badge, Avatar, Spinner, Icon                      |
| [Molecules](#molecules)               | Post card, Profile card, Pool card, Transaction status, Toast, Modal shell |
| [Organisms](#organisms)               | Feed list, Navigation bar, Wallet connect header, Tip modal, Compose modal |
| [Dark mode](#dark-mode)               | Token overrides for `data-theme="dark"`                                    |
| [Do/Don't examples](#dodont-examples) | Usage guidance per component                                               |

---

## Component inventory

The full inventory lives in [`COMPONENT_INVENTORY.md`](./COMPONENT_INVENTORY.md). It documents every reusable component under `apps/web/src/components/` with:

- Name, description, and mockup reference
- Props table (name, type, default, required)
- Variants and states
- Accessibility notes (roles, ARIA attributes, keyboard behavior)
- Copy-pasteable usage snippet
- Do / Don't guidance

| Component         | File                                              | Category  | Inventory section                                                    |
| ----------------- | ------------------------------------------------- | --------- | -------------------------------------------------------------------- |
| Button            | `apps/web/src/components/Button.tsx`              | Atom      | [Button](./COMPONENT_INVENTORY.md#button)                            |
| Input             | `apps/web/src/components/Input.tsx`               | Atom      | [Input](./COMPONENT_INVENTORY.md#input)                              |
| Textarea          | `apps/web/src/components/Textarea.tsx`            | Atom      | [Textarea](./COMPONENT_INVENTORY.md#textarea)                        |
| Badge             | `apps/web/src/components/Badge.tsx`               | Atom      | [Badge](./COMPONENT_INVENTORY.md#badge)                              |
| Avatar            | `apps/web/src/components/Avatar.tsx`              | Atom      | [Avatar](./COMPONENT_INVENTORY.md#avatar)                            |
| Spinner           | `apps/web/src/components/Spinner.tsx`             | Atom      | [Spinner](./COMPONENT_INVENTORY.md#spinner)                          |
| PostCard          | `apps/web/src/components/PostCard.tsx`            | Molecule  | [Post card](./COMPONENT_INVENTORY.md#post-card)                      |
| ProfileCard       | `apps/web/src/components/ProfileCard.tsx`         | Molecule  | [Profile card](./COMPONENT_INVENTORY.md#profile-card)                |
| PoolCard          | `apps/web/src/components/PoolCard.tsx`            | Molecule  | [Pool card](./COMPONENT_INVENTORY.md#pool-card)                      |
| TransactionStatus | `apps/web/src/components/TransactionStatus.tsx`   | Molecule  | [Transaction status](./COMPONENT_INVENTORY.md#transaction-status)    |
| Toast             | `apps/web/src/components/Toast.tsx`               | Molecule  | [Toast notification](./COMPONENT_INVENTORY.md#toast-notification)    |
| Modal             | `apps/web/src/components/Modal.tsx`               | Molecule  | [Modal shell](./COMPONENT_INVENTORY.md#modal-shell)                  |
| FeedList          | `apps/web/src/components/FeedList.tsx`            | Organism  | [Feed list](./COMPONENT_INVENTORY.md#feed-list)                      |
| NavigationBar     | `apps/web/src/components/NavigationBar.tsx`       | Organism  | [Navigation bar](./COMPONENT_INVENTORY.md#navigation-bar)            |
| WalletConnectHeader | `apps/web/src/components/WalletConnectHeader.tsx` | Organism | [Wallet connect header](./COMPONENT_INVENTORY.md#wallet-connect-header) |
| TipModal          | `apps/web/src/components/TipModal.tsx`            | Organism  | [Tip modal](./COMPONENT_INVENTORY.md#tip-modal)                      |
| ComposeModal      | `apps/web/src/components/ComposeModal.tsx`        | Organism  | [Compose modal](./COMPONENT_INVENTORY.md#compose-modal)              |

> When adding a new component, add a row here **and** a full section in `COMPONENT_INVENTORY.md`. CI checks that every file in `apps/web/src/components/` is listed.

---

## Design tokens

All tokens are defined as CSS custom properties in [`tokens.css`](./tokens.css) and as a JSON object in [`tokens.json`](./tokens.json). Reference them exclusively — never hard-code hex values in component code.

> **Single source of truth:** `tokens.json` is the canonical token definition. `tokens.css` is generated from it. The tables below are a human-readable mirror — if they disagree with `tokens.json`, `tokens.json` wins. See [`COMPONENT_INVENTORY.md#design-tokens`](./COMPONENT_INVENTORY.md#design-tokens) for the full token → CSS variable mapping.

### Color

| Token                    | Value     | Usage                                   |
| ------------------------ | --------- | --------------------------------------- |
| `--color-primary`        | `#7C3AED` | Primary CTA, active states, links       |
| `--color-primary-hover`  | `#6D28D9` | Primary hover state                     |
| `--color-primary-light`  | `#EDE9FE` | Primary tint background                 |
| `--color-secondary`      | `#06B6D4` | Secondary actions, creator token badges |
| `--color-accent`         | `#F59E0B` | Tip / reward highlights                 |
| `--color-success`        | `#10B981` | Confirmed state, success toasts         |
| `--color-error`          | `#EF4444` | Error state, delete actions             |
| `--color-warning`        | `#F59E0B` | Warning banners                         |
| `--color-bg`             | `#FFFFFF` | Card and page backgrounds               |
| `--color-surface-1`      | `#F9FAFB` | Page background                         |
| `--color-surface-2`      | `#F3F4F6` | Input backgrounds, skeleton base        |
| `--color-border`         | `#E5E7EB` | Borders at rest                         |
| `--color-border-strong`  | `#D1D5DB` | Focused borders                         |
| `--color-text-primary`   | `#111827` | Body text                               |
| `--color-text-secondary` | `#6B7280` | Timestamps, metadata                    |
| `--color-text-disabled`  | `#9CA3AF` | Disabled labels                         |

### Typography

| Token             | Value            | Usage                         |
| ----------------- | ---------------- | ----------------------------- |
| `--font-sans`     | Inter, system-ui | All UI text                   |
| `--font-mono`     | JetBrains Mono   | Addresses, transaction hashes |
| `--text-xs`       | 0.75 rem         | Tags, hints                   |
| `--text-sm`       | 0.875 rem        | Metadata, timestamps          |
| `--text-base`     | 1 rem            | Body text                     |
| `--text-lg`       | 1.125 rem        | Card titles                   |
| `--text-xl`       | 1.25 rem         | Section headings              |
| `--text-2xl`      | 1.5 rem          | Page headings                 |
| `--font-regular`  | 400              | Body                          |
| `--font-medium`   | 500              | Emphasis                      |
| `--font-semibold` | 600              | Labels, buttons               |
| `--font-bold`     | 700              | Headings                      |

### Spacing

| Token          | Value    |
| -------------- | -------- |
| `--spacing-xs` | 0.25 rem |
| `--spacing-sm` | 0.5 rem  |
| `--spacing-md` | 1 rem    |
| `--spacing-lg` | 1.5 rem  |
| `--spacing-xl` | 2 rem    |

### Shadows

| Name        | CSS value                      | Usage                     |
| ----------- | ------------------------------ | ------------------------- |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`   | Cards at rest             |
| `shadow-md` | `0 4px 8px rgba(0,0,0,0.08)`   | Elevated cards, dropdowns |
| `shadow-lg` | `0 20px 40px rgba(0,0,0,0.15)` | Modals                    |

---

## Atoms

### Button

Four variants, four states each. All buttons have `min-height: 44px` (touch target).

#### Variants

| Variant       | Background        | Text                   | Border            | Usage               |
| ------------- | ----------------- | ---------------------- | ----------------- | ------------------- |
| **primary**   | `--color-primary` | white                  | —                 | Main CTA            |
| **secondary** | transparent       | `--color-primary`      | `--color-primary` | Secondary action    |
| **ghost**     | transparent       | `--color-text-primary` | `--color-border`  | Tertiary, cancel    |
| **danger**    | `--color-error`   | white                  | —                 | Destructive actions |

#### States

| State        | Visual                                                |
| ------------ | ----------------------------------------------------- |
| **idle**     | Default colors above                                  |
| **hover**    | 8% darker background, `cursor: pointer`               |
| **disabled** | 50% opacity, `cursor: not-allowed`, no pointer events |
| **loading**  | Label replaced by `<Spinner />`, disabled             |

```html
<!-- Primary button -->
<button class="btn btn--primary">Follow</button>

<!-- Loading state -->
<button class="btn btn--primary" disabled aria-busy="true">
  <span class="spinner" aria-hidden="true"></span>
  <span class="sr-only">Loading…</span>
</button>
```

---

### Input

Single-line text field.

| State        | Border color            | Description                                 |
| ------------ | ----------------------- | ------------------------------------------- |
| **rest**     | `--color-border`        | Default                                     |
| **focus**    | `--color-border-strong` | 2px outline in `--color-primary-light`      |
| **error**    | `--color-error`         | Red border + error message below            |
| **disabled** | `--color-border`        | `--color-surface-2` background, 60% opacity |

Always pair with a `<label>` and optional hint text. Error messages go in a `role="alert"` span linked via `aria-describedby`.

---

### Textarea

Same states as Input. `resize: vertical` only. Minimum 3 rows.

---

### Badge

Pill-shaped label for metadata.

| Variant     | Background              | Text                     | Usage                 |
| ----------- | ----------------------- | ------------------------ | --------------------- |
| **default** | `--color-surface-2`     | `--color-text-secondary` | Generic tags          |
| **creator** | `--color-primary-light` | `--color-primary`        | Creator token address |
| **testnet** | `#DBEAFE`               | `#1E40AF`                | Network indicator     |
| **mainnet** | `#D1FAE5`               | `#065F46`                | Network indicator     |

---

### Avatar

Circular user avatar. Uses an SVG placeholder (person silhouette on `--color-surface-2`) when no image is available.

| Size | Diameter | Usage               |
| ---- | -------- | ------------------- |
| `sm` | 32 px    | Comment threads     |
| `md` | 40 px    | Post card           |
| `lg` | 48 px    | Profile card        |
| `xl` | 72 px    | Profile page header |

---

### Spinner

Animated CSS ring. Inherits `currentColor` for the active arc.

```html
<span class="spinner" role="status" aria-label="Loading"></span>
```

---

### Icon set

Use [Lucide icons](https://lucide.dev/) at 20×20 px for inline icons and 24×24 px for standalone. Stroke width: 2 px. Color inherits from parent.

Recommended icons:

| Use case | Lucide name          |
| -------- | -------------------- |
| Like     | `Heart` / `HeartOff` |
| Tip      | `Gem`                |
| Follow   | `UserPlus`           |
| Unfollow | `UserMinus`          |
| Share    | `Link`               |
| Delete   | `Trash2`             |
| Copy     | `Copy`               |
| Feed     | `LayoutList`         |
| Explore  | `Compass`            |
| Pool     | `Layers`             |
| Profile  | `User`               |

---

## Molecules

### Post card

Compact summary card used in feeds and profile post lists.

**Anatomy:**

1. Author row — avatar (md), username (bold), timestamp (text-sm, secondary)
2. Content — up to 280 chars, no truncation in detail view, 3-line clamp in feed
3. Action row — Like button, Tip badge, Tip button

**States:** `has_liked` toggles the heart icon from outline to filled.

**Linked to:** [`PostCard.tsx`](../../apps/web/src/components/PostCard.tsx)

---

### Profile card

Compact card for search results and explore page.

**Anatomy:**

1. Avatar (lg)
2. Username + follower count
3. Follow / Following button

**Linked to:** [`ProfileCard.tsx`](../../apps/web/src/components/ProfileCard.tsx)

---

### Pool card

Displays a community pool's balance, admin threshold, and deposit/withdraw entry points.

**Anatomy:**

1. Pool name (badge)
2. Token + balance
3. Threshold indicator (e.g., "2 of 3 admins required")
4. Deposit and Withdraw buttons

---

### Transaction status

Inline feedback shown during and after on-chain actions.

| Step                   | Icon    | Text                           | CTA                    |
| ---------------------- | ------- | ------------------------------ | ---------------------- |
| **idle**               | —       | Amount summary                 | Confirm button         |
| **awaiting signature** | Spinner | "Check Freighter…"             | —                      |
| **submitting**         | Spinner | "Submitting…"                  | —                      |
| **confirmed**          | ✅      | "Confirmed", truncated tx hash | Link to Stellar Expert |
| **failed**             | ❌      | Human-readable error           | Retry button           |

---

### Toast notification

Non-blocking feedback, auto-dismisses after 5 s.

| Variant | Left border color | Icon |
| ------- | ----------------- | ---- |
| success | `--color-success` | ✅   |
| error   | `--color-error`   | ❌   |
| info    | `--color-primary` | ℹ️   |

Positioned: top-right on desktop, bottom-center on mobile. Includes a close (×) button.

---

### Modal shell

Base container for all modal dialogs.

- Fixed `position: fixed; inset: 0` backdrop, `rgba(0,0,0,0.45)` overlay
- Modal card: `border-radius: 16px`, `shadow-lg`, max-width 420 px, responsive
- Trap focus within modal while open
- Close on backdrop click and `Escape` key

---

## Organisms

### Feed list

Vertical list of post cards with a skeleton-loader placeholder while fetching.

- Skeleton: 3 animated shimmer cards (see `skeleton-shimmer` keyframe in `globals.css`)
- Empty state: centered illustration + "No posts yet" copy

---

### Navigation bar

**Desktop:** fixed left sidebar, 240 px wide.

- Logo top-left
- Nav items: Feed, Explore, Pools, My Profile
- Active state: `--color-primary-light` background + left border in `--color-primary`

**Mobile:** fixed bottom tab bar, 56 px tall.

- 4 icon + label items
- Active: `--color-primary` filled icon

---

### Wallet connect header

Fixed header, 64 px tall.

| State            | Right slot content                                    |
| ---------------- | ----------------------------------------------------- |
| **disconnected** | "Connect Wallet" (secondary button)                   |
| **connected**    | Avatar (sm) + truncated address (G…K2) + chevron-down |

---

### Tip modal

Full tip flow inside the Modal shell.

1. Token selector (dropdown — XLM or supported assets)
2. Amount input with live fee breakdown:
   - Gross tip amount
   - Protocol fee (fee_bps %)
   - **Net to author** = gross − fee
3. Transaction status component (see above)
4. Mobile variant: bottom sheet with drag handle

---

### Compose modal

New post form inside the Modal shell.

1. Author avatar (md) + character counter (0 / 280)
2. Textarea (auto-grow, 3–6 rows)
3. Post button (primary, disabled until content ≥ 1 char)

---

## Dark mode

Dark mode activates when `data-theme="dark"` is set on `<html>`. Override the following tokens:

> **Implementation:** `ThemeProvider` (`apps/web/src/providers/ThemeProvider.tsx`) sets `data-theme` on `<html>` and persists the choice to `localStorage` under `linkora:theme`. It respects `prefers-color-scheme` when no explicit choice is stored. See [`COMPONENT_INVENTORY.md#theming`](./COMPONENT_INVENTORY.md#theming) for the full theming guide.

| Token                    | Dark value |
| ------------------------ | ---------- |
| `--color-bg`             | `#0D0D12`  |
| `--color-surface-1`      | `#1A1A23`  |
| `--color-surface-2`      | `#252530`  |
| `--color-border`         | `#2E2E3A`  |
| `--color-border-strong`  | `#3E3E4E`  |
| `--color-text-primary`   | `#F5F5F7`  |
| `--color-text-secondary` | `#8E8E93`  |
| `--color-text-disabled`  | `#4B5563`  |

All other brand and semantic tokens remain the same in dark mode to preserve contrast ratios.

### Theming

Components must consume tokens via `var(--token-name)` and never branch on theme in JS. To add a new themeable value, add the light value to `:root` in `tokens.css`, the dark override to `[data-theme="dark"]`, and both to `tokens.json`. See the [Theming section of the inventory](./COMPONENT_INVENTORY.md#theming) for a worked example.

---

## Do/Don't examples

### Button

✅ **Do** — Use `primary` for the single most important action per view.

```html
<button class="btn btn--primary">Confirm tip</button>
```

❌ **Don't** — Stack multiple primary buttons side by side.

```html
<!-- Bad: two primary buttons compete for attention -->
<button class="btn btn--primary">Like</button>
<button class="btn btn--primary">Tip</button>
```

---

### Address display

✅ **Do** — Always truncate with a copy button. Never ask users to read a full address.

```
GABC…1234  ⎘
```

❌ **Don't** — Display a raw 56-character address inline in body text.

---

### Error messages

✅ **Do** — Place the error message directly below the offending field, linked via `aria-describedby`.

❌ **Don't** — Show errors only in a banner at the top of the form.

---

### Loading states

✅ **Do** — Replace the button label with a `<Spinner />` and set `disabled` during async operations.

❌ **Don't** — Leave the button active or show a full-page spinner for a single-field action.

---

### Tip modal

✅ **Do** — Always show the fee breakdown before the user confirms.

❌ **Don't** — Deduct the fee silently without showing the net-to-author amount.

---

_Last updated by issue #163 — initial component library specification. Component inventory added in `COMPONENT_INVENTORY.md`._


---

## Component coverage and platform notes

The exhaustive per-component reference is [COMPONENT_INVENTORY.md](./COMPONENT_INVENTORY.md). It records public props, defaults, variants, accessibility requirements, and copy-ready examples for Button, Input, Card, Modal, Badge, Avatar, Tooltip, Spinner, Toast, and Tabs.

These are web React components, not shared source modules imported by the Expo/React Native app. Mobile uses platform-native equivalents; the cross-platform contract is the design token system, mirrored in `apps/mobile/theme/tokens.ts`. The inventory marks this distinction component by component.

**Visual reference status:** no published Storybook or checked-in screenshot gallery is currently configured in this repository. Component source examples and token/theme examples are linked from the inventory; the Figma entry above remains a placeholder until a real design file is published. Do not treat the placeholder as a live design link.
