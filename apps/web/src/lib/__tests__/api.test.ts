import { fetchPools } from "../api";

// Mock the global fetch
global.fetch = jest.fn();

describe("fetchPools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should throw an error when indexer returns non-ok status", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    await expect(fetchPools()).rejects.toThrow(
      "Indexer returned 500: Internal Server Error"
    );
  });

  it("should throw an error when network request fails", async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error("Network error")
    );

    await expect(fetchPools()).rejects.toThrow("Network error");
  });

  it("should return parsed pools on success", async () => {
    const mockResponse = {
      pools: [
        {
          pool_id: "test-pool",
          token: "GABC123",
          balance: "1000000",
          admins: ["GADMIN1", "GADMIN2"],
          threshold: 2,
        },
      ],
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const pools = await fetchPools();

    expect(pools).toHaveLength(1);
    expect(pools[0]).toEqual({
      id: "test-pool",
      token: "GABC123",
      balance: BigInt(1000000),
      adminCount: 2,
      threshold: 2,
    });
  });

  it("should handle array response format", async () => {
    const mockResponse = [
      {
        id: "test-pool-2",
        token: "GXYZ789",
        balance: "2000000",
        admin_count: 3,
        threshold: 2,
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const pools = await fetchPools();

    expect(pools).toHaveLength(1);
    expect(pools[0]).toEqual({
      id: "test-pool-2",
      token: "GXYZ789",
      balance: BigInt(2000000),
      adminCount: 3,
      threshold: 2,
    });
  });
});
