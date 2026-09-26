import * as SecureStore from "expo-secure-store";
import { DmService } from "../mockDm";
import { UnknownRecipientKeyError } from "../dmErrors";

describe("DmService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  });

  it("reports real local key presence instead of hardcoded true", async () => {
    const service = new DmService({ address: "GTEST" }, "https://relay.example");

    await expect(service.hasLocalKeys()).resolves.toBe(false);

    await service.generateAndPublishKeys();

    await expect(service.hasLocalKeys()).resolves.toBe(true);
  });

  it("encrypts outbound payloads and decrypts them back to the original text once both sides have published keys", async () => {
    const alice = new DmService({ address: "GALICE" }, "https://relay.example");
    const bob = new DmService({ address: "GBOB" }, "https://relay.example");

    await alice.generateAndPublishKeys();
    await bob.generateAndPublishKeys();

    await alice.sendMessage("GBOB", "super secret message");

    const thread = await alice.getMessages("GBOB");

    expect(thread).toHaveLength(1);
    expect(thread[0].ciphertext_b64).toBeTruthy();
    expect(thread[0].ciphertext_b64).not.toBe("");
    expect(thread[0].content).toBe("super secret message");
    expect(thread[0].content).not.toBe(thread[0].ciphertext_b64);
  });

  it("rejects sending to an address with no known key instead of encrypting to itself (#1561)", async () => {
    const service = new DmService({ address: "GLONELY" }, "https://relay.example");
    await service.generateAndPublishKeys();

    await expect(service.sendMessage("GNOKEY", "hello?")).rejects.toBeInstanceOf(
      UnknownRecipientKeyError
    );
    await expect(service.hasPeerKey("GNOKEY")).resolves.toBe(false);
  });
});
