/**
 * Descriptor → XDR mapping (#1591).
 *
 * `buildTxXdr` is the single place where a mobile descriptor becomes a real
 * base64 transaction envelope. The SDK client is stubbed at the prepare* helper
 * boundary so the parsing, validation and argument-ordering logic — the part
 * that was previously missing entirely — is covered for real.
 */

import { buildTxXdr, parseTxDescriptor, SUPPORTED_TX_METHODS } from "../txDescriptors";

const mockPrepareLikePostTx = jest.fn();
const mockPrepareFollowTx = jest.fn();
const mockPrepareUnfollowTx = jest.fn();
const mockPrepareBlockUserTx = jest.fn();
const mockPrepareUnblockUserTx = jest.fn();
const mockPrepareTipTx = jest.fn();
const mockPrepareDeletePostTx = jest.fn();
const mockPrepareSetProfileTx = jest.fn();
const mockPreparePoolDepositTx = jest.fn();
const mockPreparePoolWithdrawTx = jest.fn();

jest.mock("linkora-sdk", () => ({
  LinkoraClient: jest.fn().mockImplementation(() => ({
    prepareLikePostTx: mockPrepareLikePostTx,
    prepareFollowTx: mockPrepareFollowTx,
    prepareUnfollowTx: mockPrepareUnfollowTx,
    prepareBlockUserTx: mockPrepareBlockUserTx,
    prepareUnblockUserTx: mockPrepareUnblockUserTx,
    prepareTipTx: mockPrepareTipTx,
    prepareDeletePostTx: mockPrepareDeletePostTx,
    prepareSetProfileTx: mockPrepareSetProfileTx,
    preparePoolDepositTx: mockPreparePoolDepositTx,
    preparePoolWithdrawTx: mockPreparePoolWithdrawTx,
  })),
}));

const ADDRESS_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const ADDRESS_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TOKEN = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4WCTM";

const OPTIONS = {
  contractId: "CDUMMY",
  rpcUrl: "https://soroban-testnet.stellar.org",
  network: "TESTNET" as const,
};

const allPrepareMocks = [
  mockPrepareLikePostTx,
  mockPrepareFollowTx,
  mockPrepareUnfollowTx,
  mockPrepareBlockUserTx,
  mockPrepareUnblockUserTx,
  mockPrepareTipTx,
  mockPrepareDeletePostTx,
  mockPrepareSetProfileTx,
  mockPreparePoolDepositTx,
  mockPreparePoolWithdrawTx,
];

beforeEach(() => {
  jest.clearAllMocks();
  for (const mock of allPrepareMocks) {
    mock.mockResolvedValue("BUILT_XDR");
  }
});

describe("parseTxDescriptor", () => {
  it("splits a descriptor into its method and arguments", () => {
    expect(parseTxDescriptor(`like_post:${ADDRESS_A}:42`)).toEqual({
      method: "like_post",
      args: [ADDRESS_A, "42"],
    });
  });

  it("ignores surrounding whitespace", () => {
    expect(parseTxDescriptor(`  follow:${ADDRESS_A}:${ADDRESS_B}  `).method).toBe("follow");
  });

  it("rejects an empty descriptor", () => {
    expect(() => parseTxDescriptor("")).toThrow(/non-empty string/i);
    expect(() => parseTxDescriptor("   ")).toThrow(/non-empty string/i);
  });
});

describe("buildTxXdr", () => {
  it("returns the XDR produced by the SDK prepare helper", async () => {
    mockPrepareLikePostTx.mockResolvedValue("REAL_BASE64_XDR");

    await expect(buildTxXdr(`like_post:${ADDRESS_A}:42`, OPTIONS)).resolves.toBe(
      "REAL_BASE64_XDR"
    );
  });

  it("maps like_post arguments in contract order", async () => {
    await buildTxXdr(`like_post:${ADDRESS_A}:7`, OPTIONS);
    expect(mockPrepareLikePostTx).toHaveBeenCalledWith(ADDRESS_A, 7n);
  });

  it("maps follow and unfollow arguments", async () => {
    await buildTxXdr(`follow:${ADDRESS_A}:${ADDRESS_B}`, OPTIONS);
    expect(mockPrepareFollowTx).toHaveBeenCalledWith(ADDRESS_A, ADDRESS_B);

    await buildTxXdr(`unfollow:${ADDRESS_A}:${ADDRESS_B}`, OPTIONS);
    expect(mockPrepareUnfollowTx).toHaveBeenCalledWith(ADDRESS_A, ADDRESS_B);
  });

  it("maps block_user and unblock_user arguments", async () => {
    await buildTxXdr(`block_user:${ADDRESS_A}:${ADDRESS_B}`, OPTIONS);
    expect(mockPrepareBlockUserTx).toHaveBeenCalledWith(ADDRESS_A, ADDRESS_B);

    await buildTxXdr(`unblock_user:${ADDRESS_A}:${ADDRESS_B}`, OPTIONS);
    expect(mockPrepareUnblockUserTx).toHaveBeenCalledWith(ADDRESS_A, ADDRESS_B);
  });

  it("maps tip arguments including the token address and amount", async () => {
    await buildTxXdr(`tip:${ADDRESS_A}:12:${TOKEN}:500`, OPTIONS);
    expect(mockPrepareTipTx).toHaveBeenCalledWith(ADDRESS_A, 12n, TOKEN, 500n);
  });

  it("maps delete_post and set_profile arguments", async () => {
    await buildTxXdr(`delete_post:${ADDRESS_A}:99`, OPTIONS);
    expect(mockPrepareDeletePostTx).toHaveBeenCalledWith(ADDRESS_A, 99n);

    await buildTxXdr(`set_profile:${ADDRESS_A}:satoshi:${TOKEN}`, OPTIONS);
    expect(mockPrepareSetProfileTx).toHaveBeenCalledWith(ADDRESS_A, "satoshi", TOKEN);
  });

  it("maps pool_deposit arguments in contract order", async () => {
    await buildTxXdr(`pool_deposit:${ADDRESS_A}:POOL1:${TOKEN}:1000`, OPTIONS);
    expect(mockPreparePoolDepositTx).toHaveBeenCalledWith(ADDRESS_A, "POOL1", TOKEN, 1000n);
  });

  it("derives the pool_withdraw signer list from the approval entries", async () => {
    const descriptor = `pool_withdraw:POOL1:${ADDRESS_B}:750:${ADDRESS_A}=hash1,${ADDRESS_B}=hash2`;

    await buildTxXdr(descriptor, OPTIONS);

    expect(mockPreparePoolWithdrawTx).toHaveBeenCalledWith(
      [ADDRESS_A, ADDRESS_B],
      "POOL1",
      750n,
      ADDRESS_B
    );
  });

  it("exposes every method it can build", () => {
    expect(SUPPORTED_TX_METHODS).toEqual(
      expect.arrayContaining([
        "like_post",
        "follow",
        "unfollow",
        "block_user",
        "unblock_user",
        "tip",
        "delete_post",
        "set_profile",
        "pool_deposit",
        "pool_withdraw",
      ])
    );
  });

  // ── rejections ────────────────────────────────────────────────────────────

  it("rejects pool_withdraw_approve, which is not a contract entrypoint", async () => {
    await expect(
      buildTxXdr(`pool_withdraw_approve:POOL1:${ADDRESS_A}:10:${ADDRESS_A}=hash`, OPTIONS)
    ).rejects.toThrow(/unsupported transaction descriptor: "pool_withdraw_approve"/i);

    for (const mock of allPrepareMocks) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown method", async () => {
    await expect(buildTxXdr("definitely_not_a_method:1", OPTIONS)).rejects.toThrow(
      /unsupported transaction descriptor/i
    );
  });

  it("rejects a missing required field", async () => {
    await expect(buildTxXdr(`like_post:${ADDRESS_A}`, OPTIONS)).rejects.toThrow(
      /missing postId/i
    );
    await expect(buildTxXdr(`follow:${ADDRESS_A}`, OPTIONS)).rejects.toThrow(
      /missing followee/i
    );
    expect(mockPrepareLikePostTx).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric postId", async () => {
    await expect(buildTxXdr(`like_post:${ADDRESS_A}:abc`, OPTIONS)).rejects.toThrow(
      /postId must be a non-negative integer/i
    );
  });

  it("rejects a zero postId", async () => {
    await expect(buildTxXdr(`like_post:${ADDRESS_A}:0`, OPTIONS)).rejects.toThrow(
      /postId must be greater than zero/i
    );
  });

  it("rejects a fractional amount instead of silently truncating it", async () => {
    await expect(buildTxXdr(`tip:${ADDRESS_A}:1:${TOKEN}:10.5`, OPTIONS)).rejects.toThrow(
      /whole number of base units/i
    );
    expect(mockPrepareTipTx).not.toHaveBeenCalled();
  });

  it("rejects a negative amount", async () => {
    await expect(buildTxXdr(`pool_deposit:${ADDRESS_A}:POOL1:${TOKEN}:-5`, OPTIONS)).rejects.toThrow(
      /whole number of base units/i
    );
  });

  it("rejects malformed approval entries in pool_withdraw", async () => {
    await expect(
      buildTxXdr(`pool_withdraw:POOL1:${ADDRESS_B}:750:${ADDRESS_A}`, OPTIONS)
    ).rejects.toThrow(/address=hash/i);
  });

  it("rejects a pool_withdraw with no approvals", async () => {
    await expect(
      buildTxXdr(`pool_withdraw:POOL1:${ADDRESS_B}:750:`, OPTIONS)
    ).rejects.toThrow(/missing approvals/i);
  });

  it("trims whitespace around descriptor fields", async () => {
    await buildTxXdr(`follow: ${ADDRESS_A} : ${ADDRESS_B} `, OPTIONS);
    expect(mockPrepareFollowTx).toHaveBeenCalledWith(ADDRESS_A, ADDRESS_B);
  });
});