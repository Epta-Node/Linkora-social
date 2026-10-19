import { LinkoraClient } from "../client";

/**
 * Security regression tests for #1207.
 *
 * Insecure `http://` RPC endpoints must not be accepted by default. Plaintext
 * HTTP is only permitted for local (loopback) development endpoints and only
 * when explicitly opted-in via `allowHttp: true`.
 */

describe("LinkoraClient insecure HTTP RPC policy", () => {
  it("throws for a remote http:// RPC URL (non-localhost) without opt-in", () => {
    expect(
      () =>
        new LinkoraClient({
          contractId: "CDUMMY",
          rpcUrl: "http://rpc.example.com",
        })
    ).toThrow(/insecure HTTP RPC/i);
  });

  it("throws for a localhost http:// RPC URL without explicit opt-in", () => {
    expect(
      () =>
        new LinkoraClient({
          contractId: "CDUMMY",
          rpcUrl: "http://localhost:8000",
        })
    ).toThrow(/opt in explicitly/i);
  });

  it("accepts a loopback http:// RPC URL when allowHttp is explicitly true", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const client = new LinkoraClient({
        contractId: "CDUMMY",
        rpcUrl: "http://127.0.0.1:8000",
        allowHttp: true,
      });
      expect(client).toBeInstanceOf(LinkoraClient);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("throws for a remote http:// RPC URL even when allowHttp is true", () => {
    expect(
      () =>
        new LinkoraClient({
          contractId: "CDUMMY",
          rpcUrl: "http://mainnet.sorobanrpc.com",
          allowHttp: true,
        })
    ).toThrow(/only permitted for local/i);
  });

  it("accepts an https:// RPC URL without opt-in", () => {
    const client = new LinkoraClient({
      contractId: "CDUMMY",
      rpcUrl: "https://soroban-testnet.stellar.org",
    });
    expect(client).toBeInstanceOf(LinkoraClient);
  });
});
