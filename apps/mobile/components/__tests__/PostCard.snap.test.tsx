import React from "react";
import renderer from "react-test-renderer";
import { PostCard, Post } from "../PostCard";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("../../context/WalletContext", () => ({
  useWalletContext: () => ({
    wallet: { address: null },
    network: null,
    state: "disconnected",
    error: null,
    connect: jest.fn(),
    disconnect: jest.fn(),
    refresh: jest.fn(),
    setNetwork: jest.fn(),
  }),
}));
jest.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showSuccess: jest.fn(), showError: jest.fn() }),
}));

describe("PostCard Snapshots", () => {
  beforeAll(() => {
    jest.spyOn(Date, "now").mockReturnValue((1700000000 + 930 * 86400) * 1000);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const defaultPost: Post = {
    id: 1,
    author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    username: "john.doe",
    content:
      "This is a sample post content that demonstrates the PostCard component functionality.",
    tip_total: 0,
    timestamp: 1700000000,
    like_count: 42,
  };

  it("renders default state correctly", () => {
    const tree = renderer.create(<PostCard post={defaultPost} />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("renders with zero likes correctly", () => {
    const tree = renderer.create(<PostCard post={{ ...defaultPost, like_count: 0 }} />).toJSON();
    expect(tree).toMatchSnapshot();
  });

  it("renders with long content correctly", () => {
    const longContent =
      "This is a very long post content that spans multiple lines and demonstrates how the PostCard component handles longer text content. It should wrap properly and maintain good readability across different screen sizes.";
    const tree = renderer
      .create(<PostCard post={{ ...defaultPost, content: longContent }} />)
      .toJSON();
    expect(tree).toMatchSnapshot();
  });
});
