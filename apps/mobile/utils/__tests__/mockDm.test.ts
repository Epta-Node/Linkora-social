import * as SecureStore from "expo-secure-store";
import { DmService } from "../mockDm";

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

  it("encrypts outbound payloads and decrypts them back to the original text", async () => {
    const service = new DmService({ address: "GUSERA" }, "https://relay.example");

    await service.generateAndPublishKeys();
    await service.sendMessage("GUSERB", "super secret message");

    const thread = await service.getMessages("GUSERB");

    expect(thread).toHaveLength(1);
    expect(thread[0].ciphertext_b64).toBeTruthy();
    expect(thread[0].ciphertext_b64).not.toBe("");
    expect(thread[0].content).toBe("super secret message");
    expect(thread[0].content).not.toBe(thread[0].ciphertext_b64);
  });
});
