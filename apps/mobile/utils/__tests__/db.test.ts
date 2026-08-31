import { createFakeDb as mockCreateFakeDb } from "../../jest.sqlite-fake";

jest.mock("expo-sqlite", () => ({
  openDatabaseSync: () => mockCreateFakeDb(),
}));

import {
  addOutboxDmMessage,
  getDmLastRead,
  getDmMessages,
  getDmSyncCursor,
  markDmMessageFailed,
  mergeDmDeltas,
  setDmLastRead,
  setDmSyncCursor,
} from "../db";

describe("DM delta merge", () => {
  it("upserts a relay-confirmed message exactly once even if merged twice, so reconnect never duplicates it", async () => {
    const conversationId = "delta-dedup";
    const incoming = [
      {
        id: "relay-1",
        sender: "A",
        recipient: "B",
        content: "hello",
        ciphertextHash: "hash-1",
        timestamp: 100,
      },
    ];

    await mergeDmDeltas(conversationId, incoming);
    await mergeDmDeltas(conversationId, incoming); // simulate an overlapping/retried reconciliation pass

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "relay-1", syncStatus: "synced" });
  });

  it("removes the matching pending outbox row once its relay-confirmed counterpart arrives", async () => {
    const conversationId = "delta-outbox-match";
    const outbox = await addOutboxDmMessage(conversationId, "A", "B", "hi there", "shared-hash");

    await mergeDmDeltas(conversationId, [
      {
        id: "relay-2",
        sender: "A",
        recipient: "B",
        content: "hi there",
        ciphertextHash: "shared-hash",
        timestamp: 200,
      },
    ]);

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages.find((m) => m.id === outbox.id)).toBeUndefined();
    expect(messages.find((m) => m.id === "relay-2")).toMatchObject({ syncStatus: "synced" });
  });

  it("leaves an unrelated failed outbox message alone when a different message is confirmed", async () => {
    const conversationId = "delta-outbox-unrelated";
    await markDmMessageFailed(
      (await addOutboxDmMessage(conversationId, "A", "B", "oops", "hash-a")).id,
      "rejected"
    );

    await mergeDmDeltas(conversationId, [
      {
        id: "relay-3",
        sender: "A",
        recipient: "B",
        content: "other",
        ciphertextHash: "hash-b",
        timestamp: 300,
      },
    ]);

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.ciphertextHash === "hash-a")).toMatchObject({
      syncStatus: "failed",
    });
  });

  it("reports the newest timestamp in the merged batch for advancing the sync cursor", async () => {
    const result = await mergeDmDeltas("delta-newest-ts", [
      { id: "r1", sender: "A", recipient: "B", content: "a", ciphertextHash: "h1", timestamp: 50 },
      { id: "r2", sender: "A", recipient: "B", content: "b", ciphertextHash: "h2", timestamp: 400 },
      { id: "r3", sender: "A", recipient: "B", content: "c", ciphertextHash: "h3", timestamp: 250 },
    ]);
    expect(result.newestTimestamp).toBe(400);
  });
});

describe("DM sync cursor and last-read watermark", () => {
  it("defaults to 0 for a conversation that has never synced", async () => {
    expect(await getDmSyncCursor("never-synced")).toBe(0);
    expect(await getDmLastRead("never-synced")).toBe(0);
  });

  it("is monotonic: a later call with a smaller cursor never moves it backward", async () => {
    await setDmSyncCursor("mono-1", 500);
    await setDmSyncCursor("mono-1", 100);
    expect(await getDmSyncCursor("mono-1")).toBe(500);
  });

  it("advances last_read independently of the sync cursor", async () => {
    await setDmSyncCursor("mono-2", 700);
    await setDmLastRead("mono-2", 300);
    expect(await getDmSyncCursor("mono-2")).toBe(700);
    expect(await getDmLastRead("mono-2")).toBe(300);
  });
});

describe("outbox failure surfacing", () => {
  it("marks a pending outbox message failed with the relay's error, and it stays out of the synced set", async () => {
    const outbox = await addOutboxDmMessage("convo-2", "A", "B", "will fail", "hash-fail");
    await markDmMessageFailed(outbox.id, "400 invalid recipient");

    const messages = await getDmMessages("convo-2");
    const failed = messages.find((m) => m.id === outbox.id);
    expect(failed).toMatchObject({ syncStatus: "failed", errorMessage: "400 invalid recipient" });
  });
});
