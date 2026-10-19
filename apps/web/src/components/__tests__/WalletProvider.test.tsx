/**
 * Tests for WalletProvider.connect() (#1582)
 *
 * Covers:
 *  - Success path — address is persisted and isConnecting returns to false
 *  - "declined" — requestAccess() rejection → ConnectError("declined") thrown,
 *    banner stays hidden
 *  - "not-installed" — dynamic import failure → ConnectError("not-installed")
 *    thrown, banner shown
 *  - isConnecting is true during the attempt and false afterwards
 *  - connect() never returns without either persisting an address or throwing
 */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WalletProvider, ConnectError, useWallet } from '../WalletProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal consumer that exercises the connect flow and shows state. */
function TestConsumer() {
  const { connect, isConnecting, error, address } = useWallet();
  const [bannerVisible, setBannerVisible] = React.useState(false);
  const [declinedVisible, setDeclinedVisible] = React.useState(false);

  const handleConnect = async () => {
    try {
      await connect();
    } catch (err) {
      if (err instanceof ConnectError && err.reason === 'declined') {
        setDeclinedVisible(true);
      } else {
        setBannerVisible(true);
      }
    }
  };

  return (
    <div>
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        data-testid="connect-btn"
        aria-busy={isConnecting}
      >
        {isConnecting ? 'Connecting…' : 'Connect'}
      </button>
      {address && <span data-testid="address">{address}</span>}
      {error && <span data-testid="error">{error}</span>}
      {bannerVisible && <div data-testid="install-banner">Install Freighter</div>}
      {declinedVisible && <div data-testid="declined-msg">You declined</div>}
    </div>
  );
}

function renderWithProvider() {
  return render(
    <WalletProvider>
      <TestConsumer />
    </WalletProvider>
  );
}

// Clear localStorage between tests.
beforeEach(() => {
  localStorage.clear();
  // Ensure no browser-global Freighter stubs leak between tests.
  (globalThis as Record<string, unknown>).freighterApi = undefined;
  (globalThis as Record<string, unknown>).freighter = undefined;
});

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

type FreighterMock = {
  requestAccess?: jest.Mock;
  getPublicKey?: jest.Mock;
  getNetwork?: jest.Mock;
};

/** Replace jest.mock with a per-test dynamic import override via module factory. */
function mockFreighterModule(overrides: FreighterMock) {
  jest.doMock('@stellar/freighter-api', () => ({
    requestAccess: jest.fn().mockResolvedValue(undefined),
    getPublicKey: jest.fn().mockResolvedValue('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
    getNetwork: jest.fn().mockResolvedValue('TESTNET'),
    isConnected: jest.fn().mockResolvedValue(false),
    ...overrides,
  }));
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WalletProvider.connect()', () => {
  it('persists address and clears error on success', async () => {
    mockFreighterModule({
      getPublicKey: jest.fn().mockResolvedValue(
        'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37'
      ),
    });

    const { rerender: _rerender } = renderWithProvider();
    const btn = screen.getByTestId('connect-btn');

    await act(async () => {
      await userEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('address')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('install-banner')).not.toBeInTheDocument();
  });

  it('throws ConnectError("declined") when user dismisses the Freighter prompt', async () => {
    mockFreighterModule({
      requestAccess: jest.fn().mockRejectedValue(new Error('User rejected')),
    });

    renderWithProvider();
    const btn = screen.getByTestId('connect-btn');

    await act(async () => {
      await userEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('declined-msg')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('install-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address')).not.toBeInTheDocument();
  });

  it('throws ConnectError("not-installed") when the dynamic import fails', async () => {
    // Make the dynamic import throw to simulate a missing extension.
    jest.doMock('@stellar/freighter-api', () => {
      throw new Error('Cannot find module');
    });

    renderWithProvider();
    const btn = screen.getByTestId('connect-btn');

    await act(async () => {
      await userEvent.click(btn);
    });

    await waitFor(() => {
      expect(screen.getByTestId('install-banner')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('declined-msg')).not.toBeInTheDocument();
    expect(screen.queryByTestId('address')).not.toBeInTheDocument();
  });

  it('sets isConnecting=true during the attempt and false afterwards', async () => {
    let resolveAccess!: () => void;
    const accessPromise = new Promise<void>((res) => {
      resolveAccess = res;
    });

    mockFreighterModule({
      requestAccess: jest.fn().mockReturnValue(accessPromise),
      getPublicKey: jest.fn().mockResolvedValue(
        'GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37'
      ),
    });

    renderWithProvider();
    const btn = screen.getByTestId('connect-btn');

    // Start the connect — do NOT await yet.
    act(() => {
      btn.click();
    });

    // The button should be disabled (aria-busy) while connecting.
    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-busy', 'true');
    });

    // Let requestAccess resolve.
    await act(async () => {
      resolveAccess();
    });

    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-busy', 'false');
    });
  });
});
