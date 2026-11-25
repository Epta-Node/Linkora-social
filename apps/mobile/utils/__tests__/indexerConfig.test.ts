import {
  clearCustomIndexerUrl,
  getIndexerBaseUrl,
  loadCustomIndexerUrl,
  resolveIndexerBaseUrl,
  saveCustomIndexerUrl,
  validateIndexerUrl,
} from "../indexerConfig";

const store = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
  ALWAYS_THIS_DEVICE_ONLY: 2,
  setItemAsync: jest.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
  deleteItemAsync: jest.fn(async (key: string) => {
    store.delete(key);
  }),
}));

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

describe("getIndexerBaseUrl", () => {
  it("fails fast naming the missing variable when unset", () => {
    expect(() => getIndexerBaseUrl({})).toThrow(/EXPO_PUBLIC_INDEXER_URL/);
  });

  it("rejects a non-https URL outside the local-development profile", () => {
    expect(() => getIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "http://example.com" })).toThrow(
      /https/
    );
  });

  it("allows http:// only when EXPO_PUBLIC_LOCAL_DEV=1", () => {
    expect(
      getIndexerBaseUrl({
        EXPO_PUBLIC_INDEXER_URL: "http://localhost:3001",
        EXPO_PUBLIC_LOCAL_DEV: "1",
      })
    ).toBe("http://localhost:3001");
  });

  it("accepts and normalizes a trailing slash on an https URL", () => {
    expect(getIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "https://indexer.example.com/" })).toBe(
      "https://indexer.example.com"
    );
  });
});

describe("custom indexer URL persistence", () => {
  it("validates URL format before saving", async () => {
    expect(() => validateIndexerUrl("not-a-url")).toThrow(/Invalid indexer URL/i);
    await expect(saveCustomIndexerUrl("http://insecure.example.com")).rejects.toThrow(/https/i);
    expect(await loadCustomIndexerUrl()).toBeNull();
  });

  it("saves, loads, resolves, and clears a custom indexer URL in secure storage", async () => {
    const saved = await saveCustomIndexerUrl("https://custom.indexer.example///");
    expect(saved).toBe("https://custom.indexer.example");
    expect(await loadCustomIndexerUrl()).toBe("https://custom.indexer.example");
    expect(
      await resolveIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "https://default.indexer.example" })
    ).toBe("https://custom.indexer.example");

    await clearCustomIndexerUrl();
    expect(await loadCustomIndexerUrl()).toBeNull();
    expect(
      await resolveIndexerBaseUrl({ EXPO_PUBLIC_INDEXER_URL: "https://default.indexer.example" })
    ).toBe("https://default.indexer.example");
  });
});
