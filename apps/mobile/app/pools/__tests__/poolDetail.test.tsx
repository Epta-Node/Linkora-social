/**
 * #1592 — the surviving pool detail route.
 *
 * `/pools/[id]` used to render `POOL_FIXTURES` balances under a "live" badge
 * and never contact the indexer, so the badge lied about the data. It now
 * refreshes from the indexer on mount and only claims "live" when the record it
 * is rendering actually came from the chain.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: "creator-fund" }),
}));

jest.mock("../../../utils/indexerConfig", () => ({
  getIndexerBaseUrl: () => "https://indexer.test",
}));

jest.mock("../../../components/PoolDepositForm", () => ({ PoolDepositForm: () => null }));
jest.mock("../../../components/PoolWithdrawForm", () => ({ PoolWithdrawForm: () => null }));

const mockPush = jest.fn();
const mockFetch = jest.fn();

const INDEXER_ADMINS = ["G" + "A".repeat(55)];

// The screen reads the relay URL once at module scope. Pin it to "no relay" so
// the badge under test reflects indexer-sourced state rather than a socket.
// (`jest.mock` calls are hoisted above this, so the mocks above are in place.)
const previousRelayUrl = process.env.EXPO_PUBLIC_POOL_EVENTS_WS_URL;
delete process.env.EXPO_PUBLIC_POOL_EVENTS_WS_URL;
/* eslint-disable @typescript-eslint/no-var-requires */
const PoolsDetailScreen = require("../[id]").default as React.ComponentType;
const poolStore = require("../../../utils/poolStore") as typeof import("../../../utils/poolStore");
/* eslint-enable @typescript-eslint/no-var-requires */
if (previousRelayUrl !== undefined) {
  process.env.EXPO_PUBLIC_POOL_EVENTS_WS_URL = previousRelayUrl;
}

function indexerSnapshot() {
  return {
    admins: INDEXER_ADMINS,
    threshold: 1,
    balance: "20000 XLM",
    token: "XLM",
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  jest.clearAllMocks();
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
  poolStore.resetPoolState();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Pool detail screen (#1592)", () => {
  it("refreshes pool state from the indexer on mount", async () => {
    mockFetch.mockResolvedValue(jsonResponse(indexerSnapshot()));

    render(<PoolsDetailScreen />);

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("https://indexer.test/api/pools/creator-fund")
    );
  });

  it("renders the indexer balance under the live badge, not the fixture balance", async () => {
    mockFetch.mockResolvedValue(jsonResponse(indexerSnapshot()));

    render(<PoolsDetailScreen />);

    // The balance is the one the indexer returned, not the catalog fixture the
    // screen used to render under a "live" badge.
    expect(await screen.findByText(/^20,?000 XLM$/)).toBeTruthy();
    expect(screen.queryByText("18,240 XLM")).toBeNull();
    expect(await screen.findByText("live")).toBeTruthy();
  });

  it("does not claim live data when the indexer cannot be reached", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    render(<PoolsDetailScreen />);

    // The record stays unknown, so the badge must not say "live".
    expect(await screen.findByText("offline")).toBeTruthy();
    expect(screen.queryByText("live")).toBeNull();
  });

  it("navigates to the admins route nested under the single pool route", async () => {
    mockFetch.mockResolvedValue(jsonResponse(indexerSnapshot()));

    render(<PoolsDetailScreen />);

    fireEvent.press(await screen.findByRole("tab", { name: "Admins" }));
    fireEvent.press(screen.getByRole("button", { name: "Manage admins for Creator Fund" }));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/pools/creator-fund/admins");
  });
});
