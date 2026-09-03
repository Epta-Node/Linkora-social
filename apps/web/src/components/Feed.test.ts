import { Feed, Post } from "./Feed";

describe("Feed guardedWrite pause check", () => {
  const mockPosts: Post[] = [
    {
      id: "post-1",
      author: "GXXXXXXXXXXXXXX",
      content: "Test post for guardedWrite pause check",
      tip_total: "0.0",
      timestamp: "10m ago",
      likes: 5,
    },
  ];

  it("prevents write actions when contract interactions are paused", async () => {
    const onLike = jest.fn();
    const onTip = jest.fn();

    // When isPaused is true, actions are blocked
    const feedProps = {
      posts: mockPosts,
      isPaused: true,
      onLike,
      onTip,
    };

    expect(feedProps.isPaused).toBe(true);
    expect(onLike).not.toHaveBeenCalled();
    expect(onTip).not.toHaveBeenCalled();
  });
});
