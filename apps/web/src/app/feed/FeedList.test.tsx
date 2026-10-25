/**
 * Pagination coverage for issue #1724.
 *
 * `FeedList` receives the already-streamed first page as a prop, so these tests
 * can exercise infinite scroll, announcements, the slow-connection fallback and
 * retry behaviour without going through the `use()` suspension boundary.
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { FeedList } from "./FeedList";
import { QueryProvider } from "@/contexts/QueryProvider";
import { FEED_PAGE_SIZE, WALLET_REQUIRED_MESSAGE } from "@/services/feed";

const mockFetch = jest.fn();
global.fetch = mockFetch;

const makePost = (id: string, content: string) => ({
  id,
  author: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  username: id,
  content,
  like_count: 0,
  tip_total: 0,
  timestamp: 1000,
});

// `services/feed` derives `hasMore` from the page size, so a page that is
// expected to paginate must be a full page (FEED_PAGE_SIZE posts).
const makeFirstPage = () =>
  Array.from({ length: FEED_PAGE_SIZE }, (_, index) =>
    makePost(`p${index + 1}`, `Infinite post ${index + 1}`)
  );

const okResponse = (posts: unknown[], cursor: string | null) => ({
  ok: true,
  json: async () => ({ posts, cursor }),
});

const initialSnapshot = (posts: ReturnType<typeof makePost>[], cursor: string | null = null) => ({
  posts,
  cursor,
  hasMore: Boolean(cursor) && posts.length >= FEED_PAGE_SIZE,
  error: null,
  pending: false,
});

type ObserverCallback = (
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver
) => void;

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  callback: ObserverCallback;
  disconnect = jest.fn();
  observe = jest.fn();
  unobserve = jest.fn();
  takeRecords = jest.fn(() => []);

  constructor(callback: ObserverCallback) {
    this.callback = callback;
    MockIntersectionObserver.instances.push(this);
  }

  trigger(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
}

const originalIntersectionObserver = global.IntersectionObserver;

async function triggerSentinel() {
  await waitFor(() => expect(MockIntersectionObserver.instances.length).toBeGreaterThan(0));
  const observer =
    MockIntersectionObserver.instances[MockIntersectionObserver.instances.length - 1];
  act(() => observer.trigger(true));
}

describe("FeedList initial page", () => {
  it("renders the streamed page without requesting it again", async () => {
    renderFeed(
      <FeedList tab="for-you" address={null} initial={initialSnapshot(makeFirstPage())} />
    );

    expect(screen.getByText("Infinite post 1")).toBeInTheDocument();
    expect(screen.getByTestId("post-list")).toBeInTheDocument();

    // Give the hook's reset effect a chance to fire an unwanted request.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows the streamed error when the tab needs a wallet", () => {
    renderFeed(
      <FeedList
        tab="following"
        address={null}
        initial={{
          posts: [],
          cursor: null,
          hasMore: false,
          error: WALLET_REQUIRED_MESSAGE,
          pending: false,
        }}
      />
    );

    expect(screen.getByTestId("feed-error")).toHaveTextContent(WALLET_REQUIRED_MESSAGE);
  });

  it("shows an empty state when the first page has no posts", () => {
    renderFeed(<FeedList tab="for-you" address={null} initial={initialSnapshot([])} />);

    expect(screen.getByTestId("empty-feed")).toHaveTextContent("No posts yet");
  });

  it("does not announce the initial page", () => {
    renderFeed(
      <FeedList tab="for-you" address={null} initial={initialSnapshot(makeFirstPage())} />
    );

    const announcer = screen.getByTestId("feed-announcer");
    expect(announcer).toHaveAttribute("aria-live", "polite");
    expect(announcer.textContent).toBe("");
  });
});

beforeEach(() => {
  mockFetch.mockReset();
  MockIntersectionObserver.instances = [];
  global.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  global.IntersectionObserver = originalIntersectionObserver;
  delete (navigator as Navigator & { connection?: unknown }).connection;
});

describe("FeedList pagination", () => {
  function setupPaginatedFetchMock(secondPage: ReturnType<typeof makePost>[]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("cursor=cursor-1")) {
        return okResponse(secondPage, null);
      }
      return { ok: false, json: async () => ({}) };
    });
  }

  it("loads and appends the next page once, de-duplicating overlapping posts", async () => {
    const secondPage = [makePost("p20", "Infinite post 20"), makePost("p21", "Infinite post 21")];
    setupPaginatedFetchMock(secondPage);

    renderFeed(
      <FeedList
        tab="for-you"
        address={null}
        initial={initialSnapshot(makeFirstPage(), "cursor-1")}
      />
    );

    await triggerSentinel();

    await waitFor(() => expect(screen.getByText("Infinite post 21")).toBeInTheDocument());
    expect(screen.getAllByText("Infinite post 20")).toHaveLength(1);

    const feedCalls = mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/posts"));
    expect(feedCalls).toHaveLength(1);
    expect(screen.queryByTestId("load-more")).not.toBeInTheDocument();
  });

  it("shows a skeleton while the next page is in flight", async () => {
    let resolveSecondPage!: (value: unknown) => void;
    const secondPagePromise = new Promise((resolve) => {
      resolveSecondPage = resolve;
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("cursor=cursor-1")) return secondPagePromise;
      return { ok: false, json: async () => ({}) };
    });

    renderFeed(
      <FeedList
        tab="for-you"
        address={null}
        initial={initialSnapshot(makeFirstPage(), "cursor-1")}
      />
    );

    await triggerSentinel();

    expect(await screen.findByTestId("infinite-scroll-skeleton")).toBeInTheDocument();

    await act(async () => {
      resolveSecondPage(okResponse([makePost("p21", "Infinite post 21")], null));
    });

    await waitFor(() => expect(screen.getByText("Infinite post 21")).toBeInTheDocument());
    expect(screen.queryByTestId("infinite-scroll-skeleton")).not.toBeInTheDocument();
  });

  it("announces appended posts but never the initial page", async () => {
    setupPaginatedFetchMock([
      makePost("p21", "Infinite post 21"),
      makePost("p22", "Infinite post 22"),
    ]);

    renderFeed(
      <FeedList
        tab="for-you"
        address={null}
        initial={initialSnapshot(makeFirstPage(), "cursor-1")}
      />
    );

    await triggerSentinel();

    await waitFor(() => expect(screen.getByText("Infinite post 22")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("feed-announcer")).toHaveTextContent("2 more posts loaded")
    );
  });
});

describe("FeedList slow network and failures", () => {
  it("falls back to a manual Load more button on a 2g connection", async () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: {
        effectiveType: "2g",
        saveData: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
    });

    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).includes("cursor=cursor-1")) {
        return okResponse([makePost("p21", "Infinite post 21")], null);
      }
      return { ok: false, json: async () => ({}) };
    });

    renderFeed(
      <FeedList
        tab="for-you"
        address={null}
        initial={initialSnapshot(makeFirstPage(), "cursor-1")}
      />
    );

    expect(MockIntersectionObserver.instances).toHaveLength(0);
    fireEvent.click(screen.getByTestId("load-more"));

    await waitFor(() => expect(screen.getByText("Infinite post 21")).toBeInTheDocument());
  });

  it("shows an inline retry when the next page fails and does not loop", async () => {
    const cursorCalls = () =>
      mockFetch.mock.calls.filter(([url]: [string]) => String(url).includes("cursor=cursor-1"))
        .length;

    mockFetch.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));

    renderFeed(
      <FeedList
        tab="for-you"
        address={null}
        initial={initialSnapshot(makeFirstPage(), "cursor-1")}
      />
    );

    await triggerSentinel();
    await waitFor(() => expect(screen.getByTestId("infinite-scroll-retry")).toBeInTheDocument());
    expect(cursorCalls()).toBe(1);

    fireEvent.click(screen.getByTestId("infinite-scroll-retry"));
    await waitFor(() => expect(cursorCalls()).toBe(2));

    // Give an incorrect automatic retry loop time to fire.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(cursorCalls()).toBe(2);
    expect(screen.getByTestId("infinite-scroll-retry")).toBeInTheDocument();
  });
});

/**
 * FeedList now renders optimistic post actions backed by TanStack Query, so it
 * needs the provider the app mounts in `app/layout.tsx`.
 */
function renderFeed(ui: React.ReactElement) {
  return render(ui, {
    wrapper: ({ children }) => <QueryProvider>{children}</QueryProvider>,
  });
}
describe("FeedList image loading (#1748)", () => {
  it("preloads images in the first three posts and lazy loads the rest", () => {
    const posts = makeFirstPage().map((post, index) => ({
      ...post,
      imageUrl: `/media/p${index + 1}.png`,
    }));

    renderFeed(<FeedList tab="for-you" address={null} initial={initialSnapshot(posts)} />);

    const images = screen
      .getAllByTestId("post-card")
      .map((card) => card.querySelector("img") as HTMLImageElement);

    expect(images).toHaveLength(FEED_PAGE_SIZE);
    images.slice(0, 3).forEach((img) => expect(img).toHaveAttribute("fetchpriority", "high"));
    images.slice(3).forEach((img) => {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).not.toHaveAttribute("fetchpriority");
    });
  });
});
