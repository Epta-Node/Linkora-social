import React from "react";
import { act, render } from "@testing-library/react";
import FeedPage from "./page";

const mockUseWallet = jest.fn();
const mockUseFeedPersistence = jest.fn();
const mockUseMobileDetect = jest.fn();

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("@/hooks/useFeedPersistence", () => ({
  useFeedPersistence: () => mockUseFeedPersistence(),
}));

jest.mock("@/hooks/useMobileDetect", () => ({
  useMobileDetect: () => mockUseMobileDetect(),
}));

jest.mock("@/components/AppSidebar", () => ({
  AppSidebar: () => <div>AppSidebar</div>,
}));

jest.mock("@/components/onboarding/OnboardingGuard", () => ({
  OnboardingGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/AnimatedList", () => ({
  AnimatedList: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/PostCard", () => ({
  PostCard: ({ post }: { post: { id: string | number; content?: string } }) => (
    <div>{post.content ?? `Post ${post.id}`}</div>
  ),
  PostCardSkeleton: () => <div>Loading post</div>,
}));

jest.mock("@/components/cards/MasonryCard", () => ({
  MasonryCard: ({ post }: { post: { id: string | number; content?: string } }) => (
    <div>{post.content ?? `Masonry ${post.id}`}</div>
  ),
}));

jest.mock("@/components/mobile/MobileHeader", () => ({
  MobileHeader: () => <div>MobileHeader</div>,
}));

jest.mock("@/components/mobile/MobileFeed", () => ({
  MobileFeed: () => <div>MobileFeed</div>,
}));

jest.mock("@/components/forms/FieldError", () => ({
  FieldError: () => null,
}));

jest.mock("@/lib/optimisticStore", () => ({
  OptimisticStore: {
    setLikeState: jest.fn(),
    setTipState: jest.fn(),
  },
  useOptimisticLike: () => ({ isLiked: false, likeCount: 0 }),
  useOptimisticTip: () => ({ tipTotal: 0 }),
}));

jest.mock("@/lib/tx", () => ({
  buildSignAndSubmit: jest.fn(),
}));

jest.mock("../../../../../packages/sdk/src/client", () => ({
  LinkoraClient: jest.fn(),
}));

describe("FeedPage websocket cleanup", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUseWallet.mockReturnValue({
      address: null,
      connected: false,
      connect: jest.fn(),
    });
    mockUseFeedPersistence.mockReturnValue({
      isOffline: false,
      servedFromCache: false,
      setServedFromCache: jest.fn(),
      restoreScroll: jest.fn(),
      persistFeed: jest.fn(),
      getCache: jest.fn(() => null),
      clearCache: jest.fn(),
    });
    mockUseMobileDetect.mockReturnValue(false);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [], has_more: false }),
    }) as typeof fetch;

    Object.defineProperty(window, "scrollY", { value: 0, writable: true });
    window.scrollTo = jest.fn();
    jest.spyOn(global, "setTimeout");
    jest.spyOn(global, "clearTimeout");
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete (global as { WebSocket?: typeof WebSocket }).WebSocket;
  });

  it("cleans up the reconnect timer and socket when unmounted after disconnect", () => {
    class MockWebSocket {
      static instances: MockWebSocket[] = [];

      public onopen: ((event?: Event) => void) | null = null;
      public onmessage: ((event: MessageEvent) => void) | null = null;
      public onerror: (() => void) | null = null;
      public onclose: (() => void) | null = null;
      public readyState = 1;
      public send = jest.fn();
      public close = jest.fn();

      constructor(public url: string) {
        MockWebSocket.instances.push(this);
      }
    }

    (global as typeof globalThis & { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket as any;

    const { unmount } = render(<FeedPage />);
    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    act(() => {
      socket.onclose?.();
    });

    expect(setTimeout).toHaveBeenCalledTimes(1);

    unmount();

    expect(socket.close).toHaveBeenCalledTimes(1);

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(clearTimeout).toHaveBeenCalledTimes(1);
  });
});
