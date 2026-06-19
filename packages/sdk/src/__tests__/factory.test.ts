import { LinkoraClient } from "../client";

const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn(),
    Api: { isSimulationError: jest.fn(), isSimulationSuccess: jest.fn() },
  },
  Contract: jest.fn(() => ({ call: mockCall })),
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({ addOperation: mockAddOperation })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GFACTORYKEY" })) },
  xdr: {},
}));

const XDR = "AAAAfakexdrbase64encodedstring";

describe("LinkoraClient factory methods", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({
      contractId: "CDUMMY",
      factoryContractId: "CFACTORY",
      rpcUrl: "https://dummy.example.com",
    });
    mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
    mockSetTimeout.mockReturnValue({ build: mockBuild });
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue(XDR);
  });

  const addr = (s: string) => expect.objectContaining({ _val: s });
  const val = (v: unknown) => expect.objectContaining({ _val: v });

  describe("deployCreatorToken", () => {
    it("builds a tx targeting the factory contract", () => {
      const { Contract } = jest.requireMock("@stellar/stellar-sdk");

      const result = client.deployCreatorToken({
        deployer: "GDEPLOYER",
        name: "CreatorCoin",
        symbol: "CC",
        decimals: 7,
        initialSupply: 1_000_000n,
      });

      expect(result).toBe(XDR);
      // Contract should be instantiated with the factory contract ID
      expect(Contract).toHaveBeenCalledWith("CFACTORY");
      expect(mockCall).toHaveBeenCalledWith(
        "deploy_creator_token",
        addr("GDEPLOYER"),
        val("CreatorCoin"),
        val("CC"),
        val(7),
        val(1_000_000n)
      );
    });

    it("throws when factoryContractId is not configured", () => {
      const clientNoFactory = new LinkoraClient({
        contractId: "CDUMMY",
        rpcUrl: "https://dummy.example.com",
      });
      expect(() =>
        clientNoFactory.deployCreatorToken({
          deployer: "GDEPLOYER",
          name: "Coin",
          symbol: "CN",
          decimals: 7,
          initialSupply: 0n,
        })
      ).toThrow("factoryContractId is required");
    });
  });

  describe("setProfileWithNewToken", () => {
    it("returns both deploy tx and setProfile builder", () => {
      const { deployTx, setProfileTxBuilder } = client.setProfileWithNewToken("alice", {
        deployer: "GDEPLOYER",
        name: "AliceCoin",
        symbol: "ALC",
        decimals: 7,
        initialSupply: 500n,
      });

      // First TX targets the factory
      expect(deployTx).toBe(XDR);

      // Builder produces the set_profile TX targeting the main contract
      const { Contract } = jest.requireMock("@stellar/stellar-sdk");
      jest.clearAllMocks();
      mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
      mockSetTimeout.mockReturnValue({ build: mockBuild });
      mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
      mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
      mockToXDR.mockReturnValue(XDR);

      const setProfileTx = setProfileTxBuilder("GNEWTOKEN");
      expect(setProfileTx).toBe(XDR);
      expect(Contract).toHaveBeenCalledWith("CDUMMY");
      expect(mockCall).toHaveBeenCalledWith(
        "set_profile",
        addr("GDEPLOYER"),
        val("alice"),
        addr("GNEWTOKEN")
      );
    });

    it("sequences deploy before set_profile (deploy tx built first)", () => {
      const callOrder: string[] = [];
      mockCall.mockImplementation((method: string) => {
        callOrder.push(method);
        return { _type: "op" };
      });

      const { deployTx, setProfileTxBuilder } = client.setProfileWithNewToken("bob", {
        deployer: "GDEPLOYER",
        name: "BobToken",
        symbol: "BOB",
        decimals: 6,
        initialSupply: 0n,
      });

      // deployTx is built eagerly
      expect(deployTx).toBe(XDR);
      expect(callOrder[0]).toBe("deploy_creator_token");

      // setProfileTx is built lazily by the builder
      setProfileTxBuilder("GBOBTOKEN");
      expect(callOrder[1]).toBe("set_profile");
    });
  });
});
