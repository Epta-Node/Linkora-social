# Linkora Design System - Layout & Components

## Overview
High-fidelity mockups for the Linkora SocialFi web application layout shell, tipping flow, and transaction components.

**Figma Reference**: [Link to Figma file]  
**Source**: `mockups/designs/layout-shell-hgjm5vmg/index.html`

---

## Design Tokens

### Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `--bg-primary` | `#0D0D12` | Main background |
| `--bg-secondary` | `#1A1A23` | Cards, modals |
| `--bg-tertiary` | `#252530` | Skeleton base |
| `--accent-coral` | `#FF6B5B` | Primary CTA, active states |
| `--accent-teal` | `#4ECDC4` | Secondary, links |
| `--text-primary` | `#F5F5F7` | Headings |
| `--text-muted` | `#8E8E93` | Secondary text |
| `--success` | `#34D399` | Success states |
| `--error` | `#F87171` | Error states |
| `--glass` | `rgba(26, 26, 35, 0.8)` | Glassmorphism |

### Typography
| Token | Font | Weight | Usage |
|-------|------|--------|-------|
| `--font-display` | Outfit | 600-700 | Headings |
| `--font-body` | DM Sans | 400-500 | Body text |
| `--font-mono` | JetBrains Mono | 400 | Addresses, hashes |

### Spacing Scale
| Token | Value |
|-------|-------|
| `--space-xs` | 4px |
| `--space-sm` | 8px |
| `--space-md` | 16px |
| `--space-lg` | 24px |
| `--space-xl` | 32px |
| `--space-2xl` | 48px |

### Breakpoints
| Name | Width | Layout |
|------|-------|--------|
| Mobile | 375px | Bottom tab bar |
| Desktop | 1440px | Sidebar |

---

## Components

### 1. Header (64px height)
- **Logo**: Left-aligned, SVG
- **Network badge**: Center - pill shape, Testnet (blue) / Mainnet (green)
- **Wallet**: Right-aligned
  - Disconnected: Outlined "Connect Wallet" button
  - Connected: Avatar + truncated address (GAXY7...3K2)

### 2. Navigation
**Desktop**: Vertical sidebar (240px width)
- Feed, Explore, Pools, My Profile
- Active: coral left border + background

**Mobile**: Bottom tab bar (56px height)
- 4 icons with labels
- Active: filled coral icon

### 3. Post Card
- Author avatar + name + timestamp
- Content text
- Actions: Like (count), Comment, **Tip** (coral button)
- Skeleton loader: shimmer animation

### 4. Tip Modal
**Desktop**: Centered modal (400px width)
- Token selector dropdown
- Amount input + MAX button + balance display
- Fee breakdown:
  - Gross amount
  - Fee (fee_bps%)
  - Net to author
- Confirm/Tip button

**Mobile**: Bottom sheet variant
- Same content, slide-up animation
- Drag handle at top

### 5. Transaction States
| State | Visual |
|-------|--------|
| Idle | Full form, button enabled |
| Awaiting Signature | Blur overlay, "Check Freighter..." spinner |
| Submitting | "Submitting..." with progress |
| Success | Green check, tx hash (truncated), link to Stellar Expert |
| Failed | Red X, error message, "Try Again" button |

### 6. Toast Notifications
- Slide in from top-right (desktop) / bottom (mobile)
- Auto-dismiss after 5s
- Success: green icon
- Error: red icon with retry button

---

## Component States

### Navigation Item
- Default: muted gray
- Hover: lighten 10%, scale(1.05)
- Active: coral accent + left border (desktop) / filled (mobile)
- Focus: 2px coral outline

### Tip Button
- Default: coral background
- Hover: lighter coral + lift shadow
- Disabled: 50% opacity

### Wallet Button
- Disconnected: outlined coral
- Connected: avatar + truncated address

---

## External Links
- **Stellar Expert**: `https://stellar.expert/tx/{tx_hash}`
- **Freighter**: Wallet integration for signing

---

## File Structure
```
mockups/
└── designs/
    └── layout-shell-hgjm5vmg/
        ├── index.html    # Full interactive mockup
        └── brief.md    # Design brief
docs/
└── design/
    └── SPEC.md        # This file
```

---

## Notes
- Skeleton loader uses shimmer animation on gradient
- Glassmorphism: `backdrop-filter: blur(12px)`
- All touch targets min 44px on mobile
- Keyboard accessible (TAB navigation, ESC to close modals)