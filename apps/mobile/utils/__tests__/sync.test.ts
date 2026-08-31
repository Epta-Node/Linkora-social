import {
  addOutboxDmMessage,
  getDmSyncCursor,
  markDmMessageFailed,
  mergeDmDeltas,
  setDmSyncCursor,
} from "../db";
import {
  computeCiphertextHash,
  DmClient,
  DmSourceMessage,
  reconcileDmThread,
  sendDmMessageWithOutbox,
} from "../sync";

jest.mock("../db", () => ({
  addOutboxDmMessage: jest.fn(),
  confirmPendingPost: jest.fn(),
  getCachedPostById: jest.fn(),
  getDmSyncCursor: jest.fn(),
  getPendingPosts: jest.fn(),
  markDmMessageFailed: jest.fn(),
  markPendingPostFailed: jest.fn(),
  mergeDmDeltas: jest.fn(),
  reconcilePosts: jest.fn(),
  setDmSyncCursor: jest.fn(),
}));

const mockedGetDmSyncCursor = getDmSyncCursor as jest.Mock;
const mockedMergeDmDeltas = mergeDmDeltas as jest.Mock;
const mockedSetDmSyncCursor = setDmSyncCursor as jest.Mock;
const mockedAddOutboxDmMessage = addOutboxDmMessage as jest.Mock;
const mockedMarkDmMessageFailed = markDmMessageFailed as jest.Mock;

function fakeClient(overrides: Partial<DmClient> = {}): DmClient {
  return {
    getMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("computeCiphertextHash", () => {
  it("is deterministic for the same input", () => {
    expect(computeCiphertextHash("hello world")).toBe(computeCiphertextHash("hello world"));
  });

  it("differs for different content, so distinct messages never collide as duplicates", () => {
    expect(computeCiphertextHash("hello")).not.toBe(computeCiphertextHash("hell0"));
  });
});

describe("reconcileDmThread", () => {
  const conversationId = "convo-1";
  const otherAddress = "GRECIPIENT";

  it("fetches deltas strictly after the stored cursor and merges only those", async () => {
    mockedGetDmSyncCursor.mockResolvedValue(100);
    mockedMergeDmDeltas.mockResolvedValue({ mergedCount: 2, newestTimestamp: 150 });

    const source: DmSourceMessage[] = [
      { id: "m1", sender: "A", recipient: "B", content: "old", timestamp: 50 },
      { id: "m2", sender: "A", recipient: "B", content: "boundary", timestamp: 100 },
      { id: "m3", sender: "A", recipient: "B", content: "new-1", timestamp: 120 },
      { id: "m4", sender: "A", recipient: "B", content: "new-2", timestamp: 150 },
    ];
    const client = fakeClient({ getMessages: jest.fn().mockResolvedValue(source) });

    const result = await reconcileDmThread(client, conversationId, otherAddress);

    // The cursor value itself ("boundary") must NOT be re-merged — only messages
    // strictly newer than it. Mutating the filter to `>=` would break this.
    expect(mockedMergeDmDeltas).toHaveBeenCalledWith(conversationId, [
      expect.objectContaining({ id: "m3", timestamp: 120 }),
      expect.objectContaining({ id: "m4", timestamp: 150 }),
    ]);
    expect(mockedSetDmSyncCursor).toHaveBeenCalledWith(conversationId, 150);
    expect(result).toEqual({ mergedCount: 2, latestSyncedTimestamp: 150 });
  });

  it("computes the ciphertext hash from content when no ciphertext is present", async () => {
    mockedGetDmSyncCursor.mockResolvedValue(0);
    mockedMergeDmDeltas.mockResolvedValue({ mergedCount: 1, newestTimestamp: 10 });
    const client = fakeClient({
      getMessages: jest
        .fn()
        .mockResolvedValue([
          { id: "m1", sender: "A", recipient: "B", content: "hi", timestamp: 10 },
        ]),
    });

    await reconcileDmThread(client, conversationId, otherAddress);

    expect(mockedMergeDmDeltas).toHaveBeenCalledWith(conversationId, [
      expect.objectContaining({ ciphertextHash: computeCiphertextHash("hi") }),
    ]);
  });

  it("does nothing when there are no messages newer than the cursor, so reconnect never re-merges history", async () => {
    mockedGetDmSyncCursor.mockResolvedValue(200);
    const client = fakeClient({
      getMessages: jest
        .fn()
        .mockResolvedValue([
          { id: "m1", sender: "A", recipient: "B", content: "old", timestamp: 100 },
        ]),
    });

    const result = await reconcileDmThread(client, conversationId, otherAddress);

    expect(mockedMergeDmDeltas).not.toHaveBeenCalled();
    expect(mockedSetDmSyncCursor).not.toHaveBeenCalled();
    expect(result).toEqual({ mergedCount: 0, latestSyncedTimestamp: null });
  });
});

describe("sendDmMessageWithOutbox", () => {
  const conversationId = "convo-1";
  const sender = "GSENDER";
  const recipient = "GRECIPIENT";

  it("keeps the outbox entry pending and does not mark it failed when the relay accepts the send", async () => {
    const outboxMessage = {
      id: "dm_local_1",
      conversationId,
      sender,
      recipient,
      content: "hey",
      ciphertextHash: computeCiphertextHash("hey"),
      timestamp: 1000,
      syncStatus: "pending" as const,
      errorMessage: null,
    };
    mockedAddOutboxDmMessage.mockResolvedValue(outboxMessage);
    const client = fakeClient({ sendMessage: jest.fn().mockResolvedValue(undefined) });

    const result = await sendDmMessageWithOutbox(client, conversationId, sender, recipient, "hey");

    expect(client.sendMessage).toHaveBeenCalledWith(recipient, "hey");
    expect(mockedMarkDmMessageFailed).not.toHaveBeenCalled();
    expect(result).toEqual(outboxMessage);
  });

  it("surfaces a relay rejection as a failed outbox entry with the relay's error", async () => {
    const outboxMessage = {
      id: "dm_local_2",
      conversationId,
      sender,
      recipient,
      content: "hey",
      ciphertextHash: computeCiphertextHash("hey"),
      timestamp: 1000,
      syncStatus: "pending" as const,
      errorMessage: null,
    };
    mockedAddOutboxDmMessage.mockResolvedValue(outboxMessage);
    const client = fakeClient({
      sendMessage: jest.fn().mockRejectedValue(new Error("401 invalid signature")),
    });

    const result = await sendDmMessageWithOutbox(client, conversationId, sender, recipient, "hey");

    expect(mockedMarkDmMessageFailed).toHaveBeenCalledWith(
      outboxMessage.id,
      "401 invalid signature"
    );
    expect(result).toEqual({
      ...outboxMessage,
      syncStatus: "failed",
      errorMessage: "401 invalid signature",
    });
  });
});
