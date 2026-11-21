# Design System Component Inventory

> Status: living document. Update this file whenever a component is added, removed, or its public API changes.

This document is the single source of truth for the reusable components shipped in
`apps/web/src/components/. It covers props, variants, accessibility requirements,
usage examples, and the design tokens that feed them.

---

## Table of Contents

1. [Component Inventory](#component-inventory)
2. [Design Tokens](#design-tokens)
3. [Theming (Light / Dark])#theming-light---dark)
4. [Accessibility Baseline](#accessibility-baseline)

---

## Component Inventory

All components live under `apps/web/src/components/`. Each entry documents the
public props, variants, accessibility notes, and a copy-paste usage example.

### Button

**Path:** `apps/web/src/components/Button.tsx`

**Description:** Primary interaction element for actions. Supports three visual
variants and three sizes. Renders a `<button>` by default and a `<a>` when `passHref` is set.

**Variants:** `primary`, `secondary`, `ghost`

**Sizes:** `sm`, `md`, `lg`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children`? | `ReactNode` | — | Button label content. Required unless `aria-label` is provided. |
| `variant?` | `"primary" \ | "secondary" \ | "ghost"` | `"primary"` | Visual style. |
| `size?` | `"sm" \ | "md" \ | "lg"` | `"md"` | Controls padding and font size. |
| `disabled? | `boolean` | `false` | Disables interaction and applies disabled tokens. |
| `fullWidth? | `boolean` | `false` | Expands to 100% of the container. |
| `passHref?` | `string` | — | Renders as an `<a>` with the given HREF. |
| `onClick?` | `() => void` | — | Click handler. Ignored when `passHref` is set. |
| `type?` | `"button" \ | "submit" \ | "reset"` | `"button"` | Native button type. |

Accessibility:

- Always provide a visible label or an `aria-label` when the label is icon-only.
- Disabled buttons use the native `disabled` attribute so they are removed from tab (order.
- Focus ring uses the `focus-ring` token and must not be removed.

```tsx
import { Button } from "@/components/Button";

<Button variant="primary" size="md" onClick={handleSave}>
  Save changes
</Button>

<Button variant="ghost" passHref="/settings">
  Settings
</Button>
```

### Input

**Path:** `apps/web/src/components/Input.tsx`

**Description:** Single-line text field with label, helper text, and error state.

**Variants:** default, error (derived from `error`)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `id`? | `string` | auto-generated | Id used to link the label and input. |
| `label?` | `string` | — | Visible label rendered above the field. |
| `value?` | `string` | — | Controlled value. |
| `defaultValue?` | `string` | — | Uncontrolled initial value. |
| `onChange?` | `(e: ChangeEvent<HTMLInputElement>) => void` | — | Change handler. |
| `placeholder?` | `string` | — | Placeholder text. Not a replacement for a label. |
| `error?` | `string` | — | Error message; switches the field to the error variant. |
| `helpText?` | `string` | — | Helper text rendered below the field. |
| `disabled? | `boolean` | `false` | Disables the input. |
| `type?` | `string` | `"text"` | Native input type. |

Accessibility:

- Label is associated via `htmlFor`/`id`; always pass `label` or an `id`.
- Error messages are linked with `aria-describedby` and `aria-invalid="true"`.
- Never use placeholder alone to convey input purpose.

```tsx
import { Input } from "@/components/Input";

<Input
  label="Email address"
  type="email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
  helpText="We'll never share your email."
  error={!emailValid ? "Enter a valid email." : undefined}
/>
```

### Card

**Path:** `apps/web/src/components/Card.tsx`

**Description:** Surface container for grouped content. Composed of `Card.Header`,
`Card.Body`, and `Card.Footer`.

**Variants:** `default`, `interactive` (adds hover/focus affordance)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children`? | `ReactNode` | — | Card content. |
| `variant?` | `"default" \ | "interactive"` | `"default"` | Controls hover/focus affordance. |
| `padding?` | `"none" \ | "sm" \ | "md" \ | "lg"` | `"md"` | Inner padding. |
| `as?` | `React.ElementType` | `"div"` | Polymorphic root element. |

Accessibility:

- When variant is `interactive`, the root must receive either `role="button"` with `tabIndex={0}`
  or be an anchor. Do not attach click handlers to a non-interactive card.
- Headings inside `Card.Header` should use the correct semantic level for the page.

```tsx
import { Card } from "@/components/Card";

<Card padding="lg">
  <Card.Header>
    <h2>Invoice #1042</h2>
  </Card.Header>
  <Card.Body>Due on June 30, 2025.</Card.Body>
  <Card.Footer>
    <Button variant="primary">Pay now</Button>
  </Card.Footer>
</Card>
```

### Modal

**Path:** `apps/web/src/components/Modal.tsx`

**Description:** Accessible dialog built on the native `<dialog>` element. Traps focus,
closes on Escape, and restores focus to the trigger.

**Variants:** `size="sm" | "md" | "lg"`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `boolean` | — | Controls visibility. |
| `onClose` | `() => void` | — | Called on Escape, scrim click, or close button. |
| `title` | `string | | — | Dialog title; rendered in `aria-labelledby`. |
| `description? | `string` | — | Optional description in `aria-describedby`. |
| `children` | `ReactNode` | — | Modal body content. |
| `size?` | `"sm" \ | "md" \ | "lg"` | `"md" ` | Max width of the dialog. |

Accessibility:

- Root element has `role="dialog"` and `aria-modal="true"`.
- Title is required for `aria-labelledby`.
- Focus is trapped within the dialog while open; focus returns to the trigger on close.

```tsx
import { Modal } from "@/components/Modal";

<Modal open={open} onClose={() => setOpen(false)} title="Delete project?">
  <p>This action cannot be undone.</p>
  <Button variant="primary" onClick={handleDelete}>Delete</Button>
</Modal>
```

### Badge

**Path:** `apps/web/src/components/Badge.tsx`

**Description:** Small status indicator for labels and metadata.

**Variants:** `neutral`, `success`, `warning`, `error`, `info`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | — | Badge label. |
| `variant?` | `"neutral" \ | "success" \ | "warning" \ | "error" \ | "info"` | `"neutral"` | Semantic color. |
| `size?` | `"sm" \ | "md"” | `"sm"` | Padding and font size. |

Accessibility:

- Badges are purely visual; color must not be the only carrier of meaning. Include text.
- When used as a live status, wrap in an element with `aria-live="polite".

```tsx
import { Badge } from "@/components/Badge";

<Badge variant="success">Paid</Badge>
<Badge variant="error">Overdue</Badge>
```

### Avatar

**Path:** `apps/web/src/components/Avatar.tsx`

**Description:** User or entity avatar with image fallback to initials.

**Variants:** `size="xs" | "sm" | "md" | "lg"`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `src? | `string` | — | Image URL. Falls back to initials on error. |
| `name` | `string` | — | User name; used for alt text and initials. |
| `size? | `"xs" \ | "sm" \ | "md" \ | "lg"` | `"md" ` | Dimensions. |

Accessibility:

- Always pass `name`; it is used as the `img` alt text and for initials.
- Decorative avatars (next to a visible name) should set `aria-hidden="true"`.

```tsx
import { Avatar } from "@/components/Avatar";

<Avatar src={user.avatarUrl} name={user.fullName} size="md" />
```

### Tooltip

**Path:** `apps/web/src/components/Tooltip.tsx`

**Description:** Contextual label shown on hover and focus. Uses `aria-describedby`
and dismisses on Escape.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `content` | `string | | — | Tooltip text. |
| `children` | `ReactElement` | — | Trigger element. Must be focusable. |
| `side?` | `"top" \ | "right" \ | "bottom" \ | "left"` | `"top"` | Placement. |

Accessibility:

- Tooltips are supplementary. Never put essential information only in a tooltip.
- Trigger must be focusable (button, link, or `tabIndex={0}`).

```tsx
import { Tooltip } from "@/components/Tooltip";

<Tooltip content="Copy to clipboard">
  <Button variant="ghost" onClick={copy}>Copy</Button>
</Tooltip>
```

### Spinner

**Path:** `apps/web/src/components/Spinner.tsx`

**Description:** Indeterminate loading indicator.

**Variants:** `size="sm" | "md" | "lg"`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `size? | `"sm" \ | "md" \ | "lg"` | `"md" ` | Dimensions. |
| `label? | `string` | `"Loading"` | Accessible label read by screen readers. |

Accessibility:

- Root has `role="status"` and `aria-live="polite"`.
- Provide a meaningful `label` when the spinner represents a specific task.

```tsx
import { Spinner } from "@/components/Spinner";

{isLoading && <Spinner size="md" label="Loading invoices" />}
```

### Toast

**Path:** `apps/web/src/components/Toast.tsx`

**Description:** Transient notification rendered in a portal. Managed via the
`ToastProvider` and `useToast()` queue.

**Variants:** `success`, `error`, `info`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | — | Toast title. |
| `description?` | `string` | — | Optional body text. |
| `variant?` | `"success" \ | "error" \ | "info"` | `"info"` | Tone. |
| `duration?` | `number` | `5000` | Auto-dismiss in milliseconds. |

Accessibility:

- Toasts are announced via an `aria-live="assertive"` region.
- Error toasts must not auto-dismiss within 5000ms; allow the user to close manually.

```tsx
import { useToast } from "@/components/Toast";

const toast = useToast();
toast.show({ title: "Saved", variant: "success" });
```

### Tabs

**Path:** `apps/web/src/components/Tabs.tsx`

**Description:** Accessible tab list following the ARIA Tabs pattern.

**Variants:** `variant="underline" | "pill"`

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `items` | `Array<{ value: string; label: string }>` | — | Tab items. |
| `value` | `string` | — | Active tab value. |
| `onChange` | `(value: string) => void` | — | Called when the active tab changes. |
| `variant? | `"underline" \ | "pill"” | `"underline"` | Visual style. |

Accessibility:

- Root uses `role="tablist"`; each tab uses `role="tab"` and `aria-selected`.
- Arrow keys move focus between tabs; Home/End jump to first/last.

```tsx
import { Tabs } from "@/components/Tabs";

Tabs<TabValue>
  items={[
    { value: "overview", label: "Overview" },
    { value: "history", label: "History" },
  ]}
  value={tab}
  onChange={setTab}
/>
```

---

## Design Tokens

Tokens are defined in two places and must stay in sync:

- `docs/design/tokens.json` — machine-readable source of truth for tooling.
- `docs/design/tokens.css` — generated CSS custom properties consumed by the web app.
- `apps/mobile/theme/tokens.ts` — the mobile mirror of the same values.

When a token changes, edit `tokens.json` first, regenerate `tokens.css`, and then
update the mobile theme. Components consume tokens via CSS variables — never
hard-code hex values in component styles.

### Color tokens

| Token (json) | CSS variable | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| `brand.primary` | `--color-brand-primary` | `#7C3AED` | `#7C3AED` | Primary actions, links. |
| `brand.primaryHover` | `--color-brand-primary-hover` | `#6D28D9` | `#6D28D9` | Hover state of primary. |
| `brand.primaryLight` | `--color-brand-primary-light` | `#EDE)FE` | `#EDE)FE` | Subtle primary backgrounds. |
| `brand.secondary` | `--color-brand-secondary` | `#06B6D4` | `#06B6D4` | Secondary actions. |
| `brand.accent` | `--color-brand-accent` | `#F59E0B` | `#F59E0B` | Highlights, badges. |
| `semantic.success` | `--color-success` | `#10B981` | `#10B981` | Positive status. |
| `semantic.warning` | `--color-warning` | `#F59E0B` | `#F59E0B` | Cautions. |
| `semantic.error` | `--color-error` | `#EF4444` | `#EF4444` | Errors, destructive actions. |
| `semantic.info` | `--color-info` | `#3B82F6` | `#3B82F6` | Informational messages. |
| `surface.background` | `--color-surface-background` | `#FFFFFF` | `#0F172A` | Page background. |
| `surface.surface1` | `--color-surface-1` | `#F9FAFB` | `#1E293B` | Cards, panels. |
| `surface.surface2` | `--color-surface-2` | `#F3F4F6` | `#334155` | Nested surfaces. |
| `surface.border` | `--color-border` | `#E5E7EB` | `#334155` | Default borders. |
| `surface.borderStrong` | `--color-border-strong` | `#D1D5DB` | `#475569` | Emphasized borders. |
| `text.primary` | `--color-text-primary` | `#111827` | `#F9FAFB` | Body text. |
| `text.secondary` | `--color-text-secondary` | `#6B7280` | `#9CA3AF0 | Secondary text. |
| `text.disabled` | `--color-text-disabled` | `#9CA3AF` | `#4B5563` | Disabled text. |
| `text.inverse` | `--color-text-inverse` | `#FFFFFF` | `#111827` | Text on inverted surfaces. |
| `text.onBrand` | `--color-text-on-brand` | `#FFFFFF` | `#FFFFFF` | Text on brand colors. |
| `overlay.scrim` | `--color-overlay-scrim` | `rgba(17, 24, 39, 0.28)` | `rgba(15, 23, 42, 0.72)` | Modal backdrop. |

### Spacing tokens

| Token (json) | CSS variable | Value (px) |
| --- | --- | --- |
| `spacing.xs` | `--spacing-xs` | 4 ​ |
| `spacing.sm` | `--spacing-sm` | 8 |
| `spacing.md` | `--spacing-md` | 16 |
| `spacing.lg` | `--spacing-lg` | 24 |
| `spacing.xl` | `--spacing-xl` | 32 |
| `spacing.2xl` | `--spacing-2xl` | 40 |

### Radius tokens

| Token (json) | CSS variable | Value (px) |
| --- | --- | --- |
| `radius.sm` | `--radius-sm` | 4 |
| `radius.md` | `--radius-md` | 8 |
| `radius.lg` | `--radius-lg` | 12 |
| `radius.xl` | `--radius-xl` | 16 |
| `radius.full` | `--radius-full` | 9999 |

### Typography tokens

| Token (json) | CSS variable | Value |
| --- | --- | --- |
| `font.family.sans` | `--font-family-sans` | `Inter, system-ui, sans-serif` |
| `font.weight.regular` | `--font-weight-regular` | 400 |
| `font.weight.medium` | `--font-weight-medium` | 500 |
| `font.weight.bold` | `--font-weight-bold` | 700 |
| `font.size.sm` | `--font-size-sm` | `14px` |
| `font.size.md` | `--font-size-md` | `16px` |
| `font.size.lg` | `--font-size-lg` | `20px` |
| `font.size.xl` | `--font-size-xl` | `24px` |
| `font.lineHeight.tight` | `--line-height-tight` | 1.25 |
| `font.lineHeight.normal` | `--line-height-normal` | 1.5 |

### Motion tokens

| Token (json) | CSS variable | Value |
| --- | --- | --- |
| `motion.duration.fast` | `--motion-duration-fast` | `120ms` |
| `motion.duration.normal` | `--motion-duration-normal` | `200ms` |
| `motion.duration.slow` | `--motion-duration-slow` | `300ms` |
| `motion.easing.standard` | `--motion-easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` |
| `motion.easing.emphasis` | `--motion-easing-emphasis` | `cubic-bezier(0.3, 0, 0, 1)` |

> All motion must respect `window.matchMedia('(prefers-reduced-motion: reduce)')`.
When reduced motion is requested, durations collapse to `0ms`.

---

## Theming (Light / Dark)

Theming is driven by a data attribute on the `<html>` element. The default theme is
derived from the user's operating system preference and can be overridden by the user.

#### How it works

1. `docs/design/tokens.css` declares the light values on `:root` and the dark
values under `[data-theme="dark"]`.
2. The root layout sets `data-theme` to the resolved scheme on mount and updates it
when the user changes their preference.
3. Components only reference CSS variables (e.g. `var(--color-surface-background)`), so
switching themes requires no component changes.
4. The mobile app resolves the same scheme via `apps/mobile/theme/tokens.ts` and
passes `themes[scheme]` through the theme provider.

#### CSS contract

```css
/* tokens.css - simplified excerpt */
:root {
  --color-surface-background: #ffffff;
  --color-text-primary: #111827;
  --color-brand-primary: #7c3aed;
}

[data-theme="dark"] {
  --color-surface-background: #0f172a;
  --color-text-primary: #f9fafb;
  --color-brand-primary: #7c3aed;
}
```

#### Usage in a component

```tsx
// Good: theme-aware, uses tokens.
div {
  background: var(--color-surface-background);
  color: var(--color-text-primary);
}

// Bad: hard-coded colors break dark mode.
div {
  background: #ffffff;
  color: #111827;
}
```

#### Theme switching contract

- The switcher must persist the choice in `localStorage` under the key `theme`.
- Valid values: `light`, `dark`, `system`. `system` follows `prefers-color-scheme`.
- The resolved scheme is written to `<html data-theme="...">`.
- The `<meta name="theme-color">` tag is updated to match `colors.surface.background`.

---

## Accessibility Baseline

Requirements that apply to every component in this inventory:

- *+Contrast:** Text on surfaces meets WCAG AA (4.5:1 for body, 3:1 for large text).
- **Focus:** All interactive elements receive a visible focus ring using the
  `--color-brand-primary` token. Never set `outline: none` without a replacement.
- **Keyboard:** All interactions are reachable by Tab and operable by Enter/Space.
- Portal content (Modal, Tooltip, Toast) traps focus and restores it on close.
- **Reduced motion:** Transitions collapse to `0ms` when `prefers-reduced-motion`
  is set.
- Icon-only controls always have an accessible name.

---

## Maintainance

- Add a new component entry when a component is added to `apps/web/src/components/`.
- Remove entries for deleted components.
- Update the token tables whenever `docs/design/tokens.json` changes.
- Run the docs linter before merging: `npm run lint:docs`.


---

## Platform Sharing and Visual References

The reusable components documented above are implemented under `apps/web/src/components/` and are React web components. They are **not imported as shared component source by the Expo/React Native application**. The mobile application has its own platform-native UI layer. The design language is shared through documented tokens and interaction/accessibility conventions, not by sharing DOM components.

| Component | Web implementation | Shared component source with mobile? | Mobile relationship |
| --- | --- | --- | --- |
| Button | `apps/web/src/components/Button.tsx` | No | Implement the equivalent interaction with native controls and the shared design tokens. |
| Input | `apps/web/src/components/Input.tsx` | No | Native text input equivalent; preserve label and validation behavior. |
| Card | `apps/web/src/components/Card.tsx` | No | Native surface/container equivalent. |
| Modal | `apps/web/src/components/Modal.tsx` | No | Native dialog or modal presentation equivalent. |
| Badge | `apps/web/src/components/Badge.tsx` | No | Native status-label equivalent. |
| Avatar | `apps/web/src/components/Avatar.tsx` | No | Native image/initials equivalent. |
| Tooltip | `apps/web/src/components/Tooltip.tsx` | No | Use an accessible native/platform-appropriate hint where needed. |
| Spinner | `apps/web/src/components/Spinner.tsx` | No | Native activity-indicator equivalent. |
| Toast | `apps/web/src/components/Toast.tsx` | No | Native toast/announcement equivalent. |
| Tabs | `apps/web/src/components/Tabs.tsx` | No | Native tab/navigation equivalent. |

**Shared design source:** `docs/design/tokens.json` and `docs/design/tokens.css` define the web token contract; `apps/mobile/theme/tokens.ts` is the mobile theme mirror. Keep the values and semantic meaning aligned when either platform changes.

### Visual examples

There is currently no Storybook deployment or checked-in component screenshot set referenced by this repository. Until one is published, use the source-linked component examples in each entry above as the implementation reference and the token/theme examples in this document for visual behavior. The design overview's Figma link is a placeholder, not a published design file. Do not invent Storybook URLs or imply that a screenshot exists.

A future Storybook or screenshot contribution should include, at minimum, default and interactive states, disabled/error/loading states where applicable, and light/dark examples. Link the published visual artifact from this section and keep it synchronized with the prop/variant tables.
