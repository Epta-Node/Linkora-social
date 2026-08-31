import { LinkoraClient } from "../client";
import { Keypair, Networks } from "@stellar/stellar-base";

function isNetworkError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const name = (e as { name?: string }).name;
  const code = (e as { code?: string }).code;
  return name === "AggregateError" || code === "ECONNREFUSED" || code === "ENOTFOUND";
}

describe("SDK E2E Tests against Stellar Testnet", () => {
  let client: LinkoraClient;

  beforeAll(() => {
    client = new LinkoraClient({
      contractId:
        process.env.LINKORA_CONTRACT_ID ||
        "CDLDVFKHEZ2RVB3NG4UQA4VPD3TSHV6XMHXMHP2BSGCJ2IIWVTOHGDSG",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: Networks.TESTNET,
    });
  });

  describe("Contract State (read-only)", () => {
    test("getPostCount returns a non-negative bigint", async () => {
      let count: bigint;
      try {
        count = await client.getPostCount();
      } catch (e: unknown) {
        if (isNetworkError(e)) return;
        throw e;
      }
      expect(typeof count).toBe("bigint");
      expect(count).toBeGreaterThanOrEqual(0n);
    });

    test("getProfile returns null for a random address", async () => {
      let profile: Awaited<ReturnType<typeof client.getProfile>>;
      try {
        profile = await client.getProfile(Keypair.random().publicKey());
      } catch (e: unknown) {
        if (isNetworkError(e)) return;
        throw e;
      }
      expect(profile).toBeNull();
    });

    test("getPost returns null for a non-existent post ID", async () => {
      let post: Awaited<ReturnType<typeof client.getPost>>;
      try {
        post = await client.getPost(999999999);
      } catch (e: unknown) {
        if (isNetworkError(e)) return;
        throw e;
      }
      expect(post).toBeNull();
    });
  });

  describe("XDR envelope builders (offline, no network)", () => {
    const user = Keypair.random().publicKey();
    const creatorToken = Keypair.random().publicKey();

    test("setProfile returns a non-empty XDR string", () => {
      const xdr = client.setProfile(user, "testuser", creatorToken);
      expect(typeof xdr).toBe("string");
      expect(xdr.length).toBeGreaterThan(0);
    });

    test("createPost returns a non-empty XDR string", () => {
      const xdr = client.createPost(user, "hello world");
      expect(typeof xdr).toBe("string");
      expect(xdr.length).toBeGreaterThan(0);
    });
  });
});
