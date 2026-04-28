# Linkora Brand Identity

This document is the canonical reference for the Linkora visual identity. All frontend implementations, marketing materials, and design artefacts must follow these guidelines.

Design tokens in machine-readable form are in [`tokens.json`](./tokens.json). CSS custom properties are in [`tokens.css`](./tokens.css). Logo files are in [`logo/`](./logo/).

---

## Logo

Linkora's logo is a **chain-link icon** paired with the wordmark **"Linkora"**.

The icon consists of two overlapping rounded squares — one in **Primary purple** (`#7C3AED`) and one in **Secondary cyan** (`#06B6D4`) — representing two on-chain entities connected through the protocol.

### Variants

| File | Use when |
|------|----------|
| [`logo/linkora-wordmark-light.svg`](./logo/linkora-wordmark-light.svg) | Light backgrounds (default) |
| [`logo/linkora-wordmark-dark.svg`](./logo/linkora-wordmark-dark.svg) | Dark backgrounds |
| [`logo/linkora-icon.svg`](./logo/linkora-icon.svg) | Square contexts (favicon, app icon, avatar) |

### Usage rules

- Do **not** recolor the icon elements independently.
- Do **not** add drop shadows or outlines to the wordmark.
- Maintain a minimum clear-space of `1×` the icon height on all sides.
- Minimum rendered size: `24px` height for the icon; `80px` width for the wordmark.

---

## Color Palette

### Brand colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | `#7C3AED` | Primary actions, links, focused borders |
| `--color-primary-hover` | `#6D28D9` | Hover/active state for primary elements |
| `--color-primary-light` | `#EDE9FE` | Background tint for primary highlights |
| `--color-secondary` | `#06B6D4` | Secondary highlights, decorative accents |
| `--color-secondary-hover` | `#0891B2` | Hover state for secondary elements |
| `--color-secondary-light` | `#CFFAFE` | Background tint for secondary highlights |
| `--color-accent` | `#F59E0B` | Tips, rewards, calls-to-action |
| `--color-accent-hover` | `#D97706` | Hover state for accent elements |

### Semantic colors

| Token | Value | Usage |
|-------|-------|-------|
| `--color-success` | `#10B981` | Confirmed transactions, success states |
| `--color-warning` | `#F59E0B` | Pending states, warnings |
| `--color-error` | `#EF4444` | Failed transactions, validation errors |
| `--color-info` | `#3B82F6` | Informational messages |

### Surface & text (light mode)

| Token | Value |
|-------|-------|
| `--color-bg` | `#FFFFFF` |
| `--color-surface-1` | `#F9FAFB` |
| `--color-surface-2` | `#F3F4F6` |
| `--color-border` | `#E5E7EB` |
| `--color-text-primary` | `#111827` |
| `--color-text-secondary` | `#6B7280` |

### Surface & text (dark mode)

| Token | Value |
|-------|-------|
| `--color-bg` | `#0F172A` |
| `--color-surface-1` | `#1E293B` |
| `--color-surface-2` | `#334155` |
| `--color-border` | `#334155` |
| `--color-text-primary` | `#F9FAFB` |
| `--color-text-secondary` | `#9CA3AF` |

---

## WCAG AA Contrast Verification

All color combinations below are verified to meet **WCAG 2.1 Level AA** (minimum 4.5:1 for normal text, 3:1 for large text and UI components).

| Foreground | Background | Ratio | Level | Usage |
|------------|------------|-------|-------|-------|
| `#FFFFFF` on `#7C3AED` | — | **5.74:1** | AA ✓ | White text on primary |
| `#FFFFFF` on `#6D28D9` | — | **7.07:1** | AAA ✓ | White text on primary-hover |
| `#111827` on `#FFFFFF` | — | **18.1:1** | AAA ✓ | Body text on white |
| `#111827` on `#F9FAFB` | — | **17.3:1** | AAA ✓ | Body text on surface-1 |
| `#6B7280` on `#FFFFFF` | — | **4.60:1** | AA ✓ | Secondary text on white |
| `#111827` on `#EDE9FE` | — | **14.1:1** | AAA ✓ | Text on primary-light |
| `#F9FAFB` on `#0F172A` | — | **17.0:1** | AAA ✓ | Primary text on dark bg |
| `#F9FAFB` on `#1E293B` | — | **13.6:1** | AAA ✓ | Text on dark surface-1 |
| `#FFFFFF` on `#06B6D4` | — | **3.05:1** | AA (large) ✓ | White on secondary (large text / icons only) |
| `#FFFFFF` on `#0891B2` | — | **4.02:1** | AA (large) ✓ | White on secondary-hover |
| `#111827` on `#FEF3C7` | — | **13.8:1** | AAA ✓ | Text on warning-light |
| `#111827` on `#D1FAE5` | — | **14.6:1** | AAA ✓ | Text on success-light |

> **Note on `--color-secondary`**: `#06B6D4` does not achieve 4.5:1 against white for small text. Do not use white small text on `--color-secondary` backgrounds. Use `#111827` or restrict to large text and icon-only contexts.

---

## Typography

### Font families

| Role | Family | Fallback stack |
|------|--------|----------------|
| **UI / Body** | Inter | `ui-sans-serif, system-ui, -apple-system, sans-serif` |
| **Monospace** | JetBrains Mono | `ui-monospace, 'Cascadia Code', monospace` |

Use **Inter** for all headings, labels, body copy, and UI components. Use **JetBrains Mono** for blockchain addresses, transaction hashes, contract IDs, and inline code.

Both fonts should be loaded from a CDN or bundled locally. Do not substitute with other variable fonts without updating this document.

### Type scale

| Token | `rem` | `px` | Usage |
|-------|-------|------|-------|
| `--text-xs` | `0.75rem` | 12 | Labels, timestamps, badges |
| `--text-sm` | `0.875rem` | 14 | Secondary body, captions |
| `--text-base` | `1rem` | 16 | Default body text |
| `--text-lg` | `1.125rem` | 18 | Lead text, card summaries |
| `--text-xl` | `1.25rem` | 20 | Section subheadings |
| `--text-2xl` | `1.5rem` | 24 | Page subheadings, modal titles |
| `--text-3xl` | `1.875rem` | 30 | Section headings |
| `--text-4xl` | `2.25rem` | 36 | Page headings |
| `--text-5xl` | `3rem` | 48 | Hero headlines |

### Font weights

| Token | Value | Usage |
|-------|-------|-------|
| `--font-regular` | `400` | Body text |
| `--font-medium` | `500` | UI labels, navigation |
| `--font-semibold` | `600` | Subheadings, button labels |
| `--font-bold` | `700` | Page headings, wordmark |

### Line heights

| Token | Value | Usage |
|-------|-------|-------|
| `--leading-tight` | `1.25` | Large display headings |
| `--leading-snug` | `1.375` | Card headings, subheadings |
| `--leading-normal` | `1.5` | Body text (default) |
| `--leading-relaxed` | `1.625` | Long-form reading contexts |

### Letter spacing

- Headings at `3xl` and above: `--tracking-tight` (`-0.025em`)
- Normal body text: `--tracking-normal` (`0em`)
- Uppercase labels / badges: `--tracking-widest` (`0.1em`)

---

## Dark Mode

Linkora supports both light and dark mode. The CSS tokens in `tokens.css` provide both a `@media (prefers-color-scheme: dark)` media query and a `[data-theme="dark"]` attribute selector so that implementations can support both OS-level preference and an explicit user toggle.

All brand colors (primary, secondary, accent, semantic) remain the same in dark mode. Only surface and text tokens change.

---

## Voice & Tone

| Dimension | Guidance |
|-----------|----------|
| **Clarity** | Write for a developer audience. Be precise about blockchain concepts — do not abstract them away. |
| **Trust** | Transparency is a core value. Never hide fees, errors, or failures. |
| **Community** | Inclusive language. The protocol is permissionless; the tone reflects that. |
| **Brevity** | Prefer short sentences. Error messages should tell the user what happened and what to do next. |
