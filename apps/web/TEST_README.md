# Settings Page Testing Guide

## Overview

Comprehensive test suite for the settings page with full accessibility testing using jest-axe.

## Setup

Install dependencies:

```bash
npm install
```

## Running Tests

### Run all tests once

```bash
npm test
```

### Watch mode (re-run on file changes)

```bash
npm run test:watch
```

### With coverage report

```bash
npm run test:coverage
```

## Test Coverage

### Components Tested

1. **Settings Page** (`page.test.tsx`)
   - Wallet connection state handling
   - All sections rendering
   - Heading hierarchy
   - Accessibility violations

2. **Profile Section** (`ProfileSection.test.tsx`)
   - Profile form display
   - Data loading
   - Success messages
   - Accessibility

3. **Wallet Section** (`WalletSection.test.tsx`)
   - Address display and truncation
   - Network badge
   - Disconnect functionality
   - Copy to clipboard
   - Accessibility

4. **DM Key Section** (`DmKeySection.test.tsx`)
   - Publish DM key flow
   - Key rotation with confirmation
   - Active key status display
   - Accessibility

5. **Notifications Section** (`NotificationsSection.test.tsx`)
   - Toggle switches for all notification types
   - Browser push permission handling
   - Settings persistence to localStorage
   - ARIA attributes on switches
   - Accessibility

6. **Governance Section** (`GovernanceSection.test.tsx`)
   - Proposal listing
   - Vote counts and progress bars
   - Time remaining display
   - Links to vote and view all
   - Accessibility

7. **Danger Zone Section** (`DangerZoneSection.test.tsx`)
   - Delete profile confirmation dialog
   - Address validation
   - Error messages
   - Cancel functionality
   - Form labels and accessibility
   - Dialog accessibility

## Accessibility Testing

All tests include `jest-axe` checks to ensure zero accessibility violations:

```typescript
import { axe } from "jest-axe";

const { container } = render(<Component />);
const results = await axe(container);
expect(results).toHaveNoViolations();
```

### What jest-axe checks:

- Color contrast ratios
- Proper ARIA attributes
- Form label associations
- Heading hierarchy
- Keyboard navigation support
- Screen reader compatibility
- Semantic HTML usage
- Focus management

## Test Configuration

- **Framework**: Jest with ts-jest
- **Testing Library**: @testing-library/react
- **Accessibility**: jest-axe + axe-core
- **Environment**: jsdom (simulates browser)

## Mocked Dependencies

The test setup includes mocks for:

- `next/navigation` (useRouter, usePathname, useSearchParams)
- `@/hooks/useWallet` (wallet connection state)
- `@linkora/sdk` (LinkoraClient and DM key generation)
- Browser APIs (Notification, localStorage, clipboard)

## Expected Results

All tests should pass with:
✅ Zero accessibility violations
✅ Proper component rendering
✅ Correct user interactions
✅ Form validation working
✅ State management functioning

## Troubleshooting

### Tests fail with module not found

Make sure all dependencies are installed:

```bash
npm install
```

### Accessibility violations found

Review the axe-core output to identify specific issues:

- Check ARIA attributes
- Verify heading hierarchy
- Ensure form labels are associated
- Confirm proper semantic HTML

### Mock errors

If mocks aren't working, check `jest.setup.ts` to ensure all necessary mocks are configured.

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run tests
  run: |
    cd apps/web
    npm install
    npm test -- --coverage --ci
```

The `--ci` flag ensures tests run in CI mode without watch.
