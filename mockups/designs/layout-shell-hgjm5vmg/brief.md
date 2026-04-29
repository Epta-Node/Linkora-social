# Brief: Global Layout Shell, Tipping Modal, and Transaction Components

## Project Overview
- **Project**: Linkora Social - SocialFi web application built on Stellar
- **Objective**: Create high-fidelity mockups for the global navigation/layout shell, tipping flow modal, and transaction status feedback components
- **Deliverables**: Desktop (1440px) and mobile (375px) layouts with all component states

---

## Issue Context

### 1. Global Layout Shell
**Scope**:
- Header: Linkora logo, network badge (Testnet/Mainnet), wallet connect button, connected address display
- Navigation: primary nav links (Feed, Explore, Pools, My Profile)
- Mobile-responsive: bottom tab bar on small screens
- Layout grid: max-width content container, consistent spacing scale
- Empty/loading states: skeleton loaders for main content area

### 2. Tipping Flow
**Scope**:
- Tip button on post card and post detail page
- Tip modal: token selector/input, amount input, fee breakdown (gross amount → fee → net to author), confirm button
- Amount input with token unit label and balance display
- Fee breakdown: clearly shows fee_bps% deduction and net author amount
- Confirmation states: idle, awaiting signature, submitting, success (with tx hash link), error
- Mobile-optimized bottom sheet variant

### 3. Transaction Status Components
**Scope**:
- Transaction status: idle → awaiting signature → submitting → confirmed / failed
- Awaiting signature: clear instruction to open wallet, spinner
- Confirmed: success icon, transaction hash (truncated), link to Stellar Expert
- Failed: error icon, human-readable error message, retry button
- Toast notification for non-blocking feedback (e.g., successful follow)
- Full-page blocking variant for critical flows (e.g., pool withdrawal)

---

## Target Audience
- Crypto-curious creators and influencers
- Stellar ecosystem users familiar with Freighter wallet
- Users unfamiliar with token transfers (need clear UI guidance)

---

## Aesthetic Direction
**Theme**: Modern dark SocialFi aesthetic - sleek, crypto-native feel with warm accents to feel approachable

**Color Palette**:
- Background: Deep charcoal (#0D0D12) to slate (#1A1A23)
- Primary accent: Warm coral/salmon (#FF6B5B) - energetic, creator-focused
- Secondary: Soft teal (#4ECDC4) - trust, Stellar ecosystem alignment
- Text: Off-white (#F5F5F7) / Muted gray (#8E8E93)
- Success: Mint green (#34D399)
- Error: Soft red (#F87171)
- Skeleton loader: Animated gradient from #1A1A23 to #252530

**Typography**:
- Headings: "Clash Display" or "Outfit" - bold, contemporary geometric sans
- Body: "DM Sans" or "Plus Jakarta Sans" - clean, readable
- Monospace for addresses/hashes: "JetBrains Mono"

**Visual Style**:
- Glassmorphism on header and modals (backdrop-filter: blur)
- Subtle border glow on active states (coral accent)
- Smooth micro-interactions on hover/focus
- Card-based content containers with soft shadows

---

## Layout Structure

### Desktop (1440px)
**Header** (fixed, height: 64px):
- Left: Linkora logo (SVG)
- Center: Network badge pill (Testnet blue / Mainnet green)
- Right: Wallet connect button OR connected address with truncated address + avatar

**Sidebar/Navigation**:
- Vertical sidebar on left (width: 240px) for desktop
- Nav items: Feed, Explore, Pools, My Profile
- Active state: coral accent left border + background highlight

**Main Content**:
- Max-width: 640px (feed) / 1200px (pools)
- Centered in viewport
- Skeleton loaders with shimmer animation

### Mobile (375px)
**Bottom Tab Bar**: (height: 56px)
- 4 icons: Home (Feed), Compass (Explore), Pool (Pools), User (Profile)
- Active: coral fill, Inactive: muted gray

**Header**: Same as desktop but more compact

---

## Component States

### Navigation
- Default: Muted gray icon/text
- Hover: lighten 10%, subtle scale (1.05)
- Active/Focus: Coral accent color, left border (desktop) / filled icon (mobile)
- Focus visible: 2px coral outline

### Wallet Button
- Disconnected: Outlined button, coral border, "Connect Wallet" text
- Connected: Avatar circle + truncated address (e.g., "GAXY7...3K2"), dropdown chevron

### Tip Button
- Default: Coral background, white text
- Hover: Slightly lighter coral, subtle lift shadow
- Disabled: 50% opacity, no pointer

### Transaction States
1. **Idle**: Full amount shown, "Confirm" button enabled
2. **Awaiting Signature**: Blur overlay, "Check Freighter..." with spinner
3. **Submitting**: "Submitting..." text, progress indicator
4. **Success**: Green check, "Confirmed" text, truncated tx hash (link to Stellar Expert)
5. **Failed**: Red X, error message, "Try Again" button

---

## Content for Mockups

### Feed Page Mockup
- Header + Sidebar visible
- 2-3 post cards in feed with skeleton loaders (or sample content)
- Post card shows: author avatar + name, timestamp, content text, tip button, like count

### Tip Modal (Desktop)
- Overlay with backdrop blur
- Centered modal (400px width)
- Token selector dropdown
- Amount input with balance shown
- Fee breakdown section
- Action buttons

### Tip Bottom Sheet (Mobile)
- Slide up from bottom
- Full-width on mobile
- Same content, optimized touch targets

### Transaction Toast
- Slide in from top-right (desktop) / bottom (mobile)
- Auto-dismiss after 5s
- Icon + message + close button

---

## Mobile Considerations
- Touch targets minimum 44px
- Bottom sheet with drag handle
- Keyboard-aware (pushes content up)
- Safe area insets considered

---

## Output Requirements
- **Single HTML file** with embedded CSS and JS
- Responsive at 1440px and 375px breakpoints
- Interactive states (hover, focus, active)
- CSS variables for theming
- No external dependencies except Google Fonts

---

## File Output
- Path: `C:\Users\pc\drips\Linkora-social\mockups\designs\layout-shell-hgjm5vmg\index.html`