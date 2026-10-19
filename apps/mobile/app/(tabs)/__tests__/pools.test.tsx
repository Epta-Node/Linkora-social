/**
 * #1592 / #1594 — pool card navigation.
 *
 * #1592: a pool card in the Pools tab used to push `/pool/${id}`, a second
 * detail screen backed by ids (`pool-1/2/3`) that no card ever produced, so
 * every tap opened "Pool not found". Cards must navigate to `/pools/${id}`,
 * and the detail screen that route resolves to must render that same pool.
 *
 * #1594: `PoolCard` used to be a `TouchableOpacity` with its own `onPress`
 * *and* be wrapped in another `TouchableOpacity` by the tab, so one tap fired
 * `router.push` twice. There must be exactly one press handler per card and
 * exactly one navigation per tap.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => (mockPushedId === null ? {} : { id: mockPushedId }),
}));

jest.mock("../../../utils/indexerConfig", () => ({
  getIndexerBaseUrl: () => "https://indexer.test",
}));

jest.mock("../../../components/PoolDepositForm", () => ({ PoolDepositForm: () => null }));
jest.mock("../../../components/PoolWithdrawForm", () => ({ PoolWithdrawForm: () => null }));

import PoolsScreen from "../pools";
import PoolsDetailScreen from "../../pools/[id]";

const mockPush = jest.fn();
const mockFetch = jest.fn();

/** The pool the tab pushed to; the detail screen reads it as its route param. */
let mockPushedId: string | null = null;

const INDEXER_ADMINS = ["G" + "A".repeat(55)];

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function setIndexerUp() {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/api/pools")) {
      return jsonResponse({
        pools: [
          { pool_id: "creator-fund", token: "XLM", balance: "20000", threshold: 1 },
          { pool_id: "music-drops", token: "NOVA", balance: "7900", threshold: 1 },
        ],
      });
    }
    if (url.includes("/api/pools/")) {
      return jsonResponse({
        admins: INDEXER_ADMINS,
        threshold: 1,
        balance: "20000 XLM",
        token: "XLM",
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPushedId = null;
  (global as unknown as { fetch: unknown }).fetch = mockFetch;
  setIndexerUp();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Pools tab card navigation (#1592, #1594)", () => {
  it("navigates exactly once per tap, to /pools/[id]", async () => {
    render(<PoolsScreen />);

    const card = await screen.findByTestId("pool-card-creator-fund");
    fireEvent.press(card);

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/pools/creator-fund");
  });

  it("routes each card to its own id", async () => {
    render(<PoolsScreen />);

    await screen.findByTestId("pool-card-music-drops");
    fireEvent.press(screen.getByTestId("pool-card-music-drops"));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/pools/music-drops");
  });

  it("renders the correct pool on the detail screen the card navigated to", async () => {
    const { unmount } = render(<PoolsScreen />);

    const card = await screen.findByTestId("pool-card-creator-fund");
    fireEvent.press(card);
    mockPushedId = String(mockPush.mock.calls[0][0]).replace("/pools/", "");
    unmount();

    render(<PoolsDetailScreen />);

    expect(await screen.findByText("Creator Fund")).toBeTruthy();
    // The balance came from the indexer refresh, not the catalog fixture.
    await waitFor(() => expect(screen.getByText(/^20,?000 XLM$/)).toBeTruthy());
    expect(screen.queryByText("18,240 XLM")).toBeNull();
  });
});

describe("Pool card press ownership (#1594)", () => {
  it("keeps the press handler on the wrapper, not on PoolCard", async () => {
    render(<PoolsScreen />);

    const card = await screen.findByTestId("pool-card-creator-fund");
    // PoolCard is presentational: it registers no press action and no role of
    // its own, so the card cannot double-fire the wrapper's `onPress`.
    expect(card.props.onPress).toBeUndefined();
    expect(card.props.accessibilityRole).toBeUndefined();
  });

  it("exposes a single accessibility role/label pair per card", async () => {
    render(<PoolsScreen />);

    await screen.findByTestId("pool-card-creator-fund");

    expect(
      screen.getAllByRole("button", { name: "Creator Fund, balance 20,000 XLM" })
    ).toHaveLength(1);
  });
});
