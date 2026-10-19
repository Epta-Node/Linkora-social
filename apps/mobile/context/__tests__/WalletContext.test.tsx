/**
 * #1593 — wallet session persistence.
 *
 * A session must remember the adapter that created it and the network it was
 * established on, restore through that same adapter on the next cold start, and
 * only delete stored credentials when the adapter definitively says the session
 * is gone.
 */
import { renderHook, waitFor, act } from "@testing-library/react-native";

const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockSecureStore.has(key) ? mockSecureStore.get(key)! : null)
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStore.delete(key);
    return Promise.resolve();
  }),
}));

/** Mutable so a test can simulate the user switching networks in settings. */
const mockSelectedNetwork = { id: "TESTNET" };

jest.mock("../NetworkContext", () => {
  const actual = jest.requireActual("../NetworkContext");
  return {
    ...actual,
    useNetworkContext: () => ({
      network: actual.NETWORK_PRESETS[mockSelectedNetwork.id],
      settings: {
        selectedNetwork: mockSelectedNetwork.id,
        rpcUrl: actual.NETWORK_PRESETS[mockSelectedNetwork.id].rpcUrl,
      },
    }),
  };
});

import { WalletProvider, useWalletContext } from "../WalletContext";
import {
  setWalletAddress,
  setConnectionState,
  getWalletAddress,
  getConnectionState,
} from "../../utils/secureStorage";

const ADDRESS = "G" + "A".repeat(55);

type Provider = "freighter" | "walletconnect";

function makeKit(overrides: Record<string, unknown> = {}) {
  return {
    connect: jest.fn(async () => ({ publicKey: ADDRESS })),
    disconnect: jest.fn(async () => {}),
    isConnected: jest.fn(async () => true),
    getPublicKey: jest.fn(async () => ADDRESS),
    ...overrides,
  };
}

function makeFreighter(overrides: Record<string, unknown> = {}) {
  return {
    isConnected: jest.fn(async () => true),
    getPublicKey: jest.fn(async () => ADDRESS),
    requestAccess: jest.fn(async () => ({ address: ADDRESS })),
    ...overrides,
  };
}

async function seedSession(
  provider: Provider | undefined,
  { address = ADDRESS, network = "TESTNET" } = {}
) {
  await setWalletAddress(address);
  await setConnectionState({
    connected: true,
    address,
    provider,
    network,
    timestamp: Date.now(),
  });
}

function renderWallet() {
  return renderHook(() => useWalletContext(), {
    wrapper: ({ children }) => <WalletProvider>{children}</WalletProvider>,
  });
}

describe("WalletContext session persistence (#1593)", () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockSelectedNetwork.id = "TESTNET";
    globalThis.__LINKORA_WALLET_KIT__ = makeKit() as never;
    globalThis.__LINKORA_FREIGHTER_API__ = makeFreighter();
  });

  afterEach(() => {
    delete (globalThis as { __LINKORA_WALLET_KIT__?: unknown }).__LINKORA_WALLET_KIT__;
    delete (globalThis as { __LINKORA_FREIGHTER_API__?: unknown }).__LINKORA_FREIGHTER_API__;
  });

  it("restores a persisted Freighter session through Freighter, not WalletConnect", async () => {
    await seedSession("freighter");
    const kit = globalThis.__LINKORA_WALLET_KIT__ as unknown as ReturnType<typeof makeKit>;
    const freighter = globalThis.__LINKORA_FREIGHTER_API__ as unknown as ReturnType<
      typeof makeFreighter
    >;

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.wallet).toMatchObject({
      address: ADDRESS,
      provider: "freighter",
      network: "TESTNET",
    });
    expect(freighter.getPublicKey).toHaveBeenCalled();
    expect(kit.getPublicKey).not.toHaveBeenCalled();
    expect(kit.isConnected).not.toHaveBeenCalled();
  });

  it("restores a persisted WalletConnect session through WalletConnect, not Freighter", async () => {
    await seedSession("walletconnect");
    const kit = globalThis.__LINKORA_WALLET_KIT__ as unknown as ReturnType<typeof makeKit>;
    const freighter = globalThis.__LINKORA_FREIGHTER_API__ as unknown as ReturnType<
      typeof makeFreighter
    >;

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.wallet).toMatchObject({
      address: ADDRESS,
      provider: "walletconnect",
      network: "TESTNET",
    });
    expect(kit.getPublicKey).toHaveBeenCalled();
    expect(freighter.getPublicKey).not.toHaveBeenCalled();
  });

  it("never prompts the Freighter extension while restoring", async () => {
    await seedSession("freighter");
    const freighter = globalThis.__LINKORA_FREIGHTER_API__ as unknown as ReturnType<
      typeof makeFreighter
    >;

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(freighter.requestAccess).not.toHaveBeenCalled();
  });

  it("records the network the session was established on, without hardcoding TESTNET", async () => {
    await seedSession("freighter", { network: "MAINNET" });

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("connected"));
    // The session's origin network is preserved as provenance...
    expect(result.current.wallet.network).toBe("MAINNET");
    // ...while the active network is the one the app has selected, not the
    // hardcoded "TESTNET" this used to be seeded with.
    expect(result.current.network).toBe("TESTNET");
  });

  it("follows a network switch instead of reporting a stale network (#1593)", async () => {
    await seedSession("freighter", { network: "TESTNET" });

    const { result, rerender } = renderWallet();
    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.network).toBe("TESTNET");

    await act(async () => {
      mockSelectedNetwork.id = "MAINNET";
    });
    // Re-render so the provider reads the new selection.
    rerender({});

    expect(result.current.network).toBe("MAINNET");
    // Switching networks must not disturb the live session.
    expect(result.current.state).toBe("connected");
    expect(result.current.wallet.address).toBe(ADDRESS);
  });

  it("probes both adapters for a legacy session and records the one that matched", async () => {
    await seedSession(undefined);
    expect((await getConnectionState())?.provider).toBeUndefined();

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("connected"));
    expect(result.current.wallet.provider).toBe("freighter");
    await waitFor(async () => {
      expect((await getConnectionState())?.provider).toBe("freighter");
    });
  });

  it("clears the stored session when the recorded adapter reports it is gone", async () => {
    await seedSession("walletconnect");
    globalThis.__LINKORA_WALLET_KIT__ = makeKit({
      isConnected: jest.fn(async () => false),
    }) as never;

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("disconnected"));
    expect(result.current.wallet.address).toBeNull();
    await waitFor(async () => {
      expect(await getWalletAddress()).toBeNull();
      expect(await getConnectionState()).toBeNull();
    });
  });

  it("keeps the stored session when the adapter cannot be verified", async () => {
    await seedSession("freighter");
    globalThis.__LINKORA_FREIGHTER_API__ = makeFreighter({
      isConnected: jest.fn(async () => {
        throw new Error("extension unavailable");
      }),
    });

    const { result } = renderWallet();

    await waitFor(() => expect(result.current.state).toBe("disconnected"));
    // Unverifiable is not invalid — the credentials must survive for a retry.
    expect(await getWalletAddress()).toBe(ADDRESS);
    expect(await getConnectionState()).not.toBeNull();
  });

  it("persists provider and network when a wallet connects", async () => {
    const { result } = renderWallet();
    await waitFor(() => expect(result.current.state).toBe("disconnected"));

    await act(async () => {
      await result.current.connect("freighter");
    });

    expect(result.current.state).toBe("connected");
    await waitFor(async () => {
      expect(await getConnectionState()).toMatchObject({
        connected: true,
        address: ADDRESS,
        provider: "freighter",
        network: "TESTNET",
      });
    });
  });

  it("disconnect clears the session and only tears down the active provider", async () => {
    await seedSession("freighter");
    const kit = globalThis.__LINKORA_WALLET_KIT__ as unknown as ReturnType<typeof makeKit>;

    const { result } = renderWallet();
    await waitFor(() => expect(result.current.state).toBe("connected"));

    await act(async () => {
      await result.current.disconnect();
    });

    expect(kit.disconnect).not.toHaveBeenCalled();
    expect(await getWalletAddress()).toBeNull();
    expect(await getConnectionState()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #1196 — no state updates on unmounted components
// ---------------------------------------------------------------------------

describe("WalletContext listener / unmount safety (#1196)", () => {
  beforeEach(() => {
    mockSecureStore.clear();
    delete (globalThis as { __LINKORA_WALLET_KIT__?: unknown }).__LINKORA_WALLET_KIT__;
    delete (globalThis as { __LINKORA_FREIGHTER_API__?: unknown }).__LINKORA_FREIGHTER_API__;
  });

  it("does not update state after unmounting mid-checkConnectionState", async () => {
    // Seed a freighter session so checkConnectionState has something to do.
    await seedSession("freighter");

    // Slow down the freighter probe so the component can unmount before it finishes.
    let resolveProbe!: () => void;
    const probePromise = new Promise<void>((res) => {
      resolveProbe = res;
    });

    globalThis.__LINKORA_FREIGHTER_API__ = {
      isConnected: jest.fn(async () => {
        await probePromise;
        return true;
      }),
      getPublicKey: jest.fn(async () => ADDRESS),
    };

    const spy = jest.spyOn(console, "error");

    const { unmount, result } = renderWallet();

    // Still loading — unmount immediately before the probe resolves.
    expect(result.current.state).toBe("loading");
    unmount();

    // Now let the probe finish — state setters should not fire.
    await act(async () => {
      resolveProbe();
      await new Promise((r) => setTimeout(r, 10));
    });

    // No "Can't perform a React state update on an unmounted component" warning.
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("unmounted")
    );
    spy.mockRestore();
  });

  it("does not update state after unmounting mid-connect", async () => {
    // A very slow requestFreighterAddress call.
    let resolveConnect!: () => void;
    const connectPromise = new Promise<void>((res) => {
      resolveConnect = res;
    });

    globalThis.__LINKORA_FREIGHTER_API__ = makeFreighter({
      requestAccess: jest.fn(async () => {
        await connectPromise;
        return { address: ADDRESS };
      }),
    });

    const spy = jest.spyOn(console, "error");

    const { unmount, result } = renderWallet();
    await waitFor(() => expect(result.current.state).toBe("disconnected"));

    // Start the connect without awaiting.
    let connectDone = false;
    act(() => {
      result.current.connect("freighter").finally(() => {
        connectDone = true;
      });
    });

    // Component transitions to "connecting" — then we unmount.
    await waitFor(() => expect(result.current.state).toBe("connecting"));
    unmount();

    // Resolve the slow requestAccess.
    await act(async () => {
      resolveConnect();
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(connectDone).toBe(true);
    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("unmounted")
    );
    spy.mockRestore();
  });

  it("does not accumulate listeners across repeated mount/unmount cycles", async () => {
    globalThis.__LINKORA_FREIGHTER_API__ = makeFreighter();
    await seedSession("freighter");

    const callCounts: number[] = [];

    for (let i = 0; i < 5; i++) {
      const { unmount } = renderWallet();
      // Small delay to let effects fire.
      await act(async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      unmount();
    }

    const freighter = globalThis.__LINKORA_FREIGHTER_API__ as unknown as ReturnType<
      typeof makeFreighter
    >;

    // isConnected should not have been called more times than the number of mounts
    // (one call per mount cycle — not accumulating).
    callCounts.push((freighter.isConnected as jest.Mock).mock.calls.length);
    expect(callCounts[0]).toBeLessThanOrEqual(5);
  });
});
