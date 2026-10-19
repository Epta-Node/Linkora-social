import * as SecureStore from "expo-secure-store";

import { createMiniAppBridge } from "../bridge";
import { BridgeError } from "../permissions";

// A tiny in-memory stand-in for the keychain so the "token is really there"
// case can be exercised without a device.
const store: Record<string, string> = {};

beforeEach(async () => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store[key] = value;
  });
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
    const item = store[key];
    return item === undefined ? null : item;
  });
  await SecureStore.setItemAsync(
    "wallet_address",
    JSON.stringify("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")
  );
  await SecureStore.setItemAsync("auth_token", JSON.stringify("bearer-token-value-abc123"));
});

describe("mini app bridge sandbox", () => {
  it("cannot be constructed without an approval callback", () => {
    expect(() =>
      // @ts-expect-error — requestUserApproval is required, not optional (#1552)
      createMiniAppBridge({ permissions: ["wallet.signTransaction"] })
    ).toThrow(/requestUserApproval/);
  });

  it("dismissing the approval prompt rejects the call rather than resolving it", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.signTransaction"],
      // Simulates a dismissed native prompt: resolves false, never true.
      requestUserApproval: async () => false,
      handlers: {
        "wallet.signTransaction": async () => ({ signedXdr: "signed-by-wallet" }),
      },
    });

    await expect(
      bridge.call("wallet.signTransaction", { txXdr: "unsigned" })
    ).rejects.toMatchObject({ code: "UserRejected" });
  });

  it("requires approval for post.create, not just wallet.* methods", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["post.create"],
      requestUserApproval: async () => false,
      handlers: {
        "post.create": async () => ({ postId: 1 }),
      },
    });

    await expect(bridge.call("post.create", { content: "hi" })).rejects.toMatchObject({
      code: "UserRejected",
    });
  });

  it("returns PermissionDenied when a call lacks a declared permission", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.getAddress"],
      requestUserApproval: async () => true,
      handlers: {
        "wallet.signTransaction": async () => ({ signedTxXdr: "signed" }),
      },
    });

    await expect(
      bridge.call("wallet.signTransaction", { txXdr: "unsigned" })
    ).rejects.toMatchObject({ code: "PermissionDenied" });
  });

  it("returns UserRejected when wallet.sign is not approved", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.sign"],
      requestUserApproval: async () => false,
      handlers: {
        "wallet.sign": async () => ({ signature: "signed" }),
      },
    });

    await expect(bridge.call("wallet.sign", "payload")).rejects.toMatchObject({
      code: "UserRejected",
    });
  });

  it("rejects wallet.signTransaction with MethodUnavailable when no host handler is registered (#1553)", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.signTransaction"],
      requestUserApproval: async () => true,
    });

    await expect(
      bridge.call("wallet.signTransaction", { txXdr: "unsigned" })
    ).rejects.toMatchObject({ code: "MethodUnavailable" });
  });

  it("resolves wallet.signTransaction only with the host handler's wallet-produced signature (#1553)", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.signTransaction"],
      requestUserApproval: async () => true,
      handlers: {
        "wallet.signTransaction": async () => ({ signedXdr: "signed-by-wallet" }),
      },
    });

    await expect(bridge.call("wallet.signTransaction", { txXdr: "unsigned" })).resolves.toEqual({
      signedXdr: "signed-by-wallet",
    });
  });

  it("prevents a mini app from calling undeclared bridge methods", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["wallet.getAddress"],
      requestUserApproval: async () => true,
      handlers: {
        "wallet.getAddress": async () => "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
        "profile.get": async () => ({ username: "maya" }),
      },
    });

    await expect(bridge.call("profile.get")).rejects.toBeInstanceOf(BridgeError);
    await expect(bridge.call("profile.get")).rejects.toMatchObject({
      code: "PermissionDenied",
    });
  });
});

describe("bridge responses never carry secrets (#1554)", () => {
  // A value the app's keychain would hold. If any of these strings shows up in
  // a bridge response, a mini app can impersonate the user against the
  // indexer and the permission model collapses.
  const SECRETS = [
    "bearer-token-value-abc123",
    "eyJhbGciOiJIUzI1NiJ9.super-secret-jwt-payload.signature",
  ];

  const ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  function expectNoSecrets(value: unknown) {
    const serialized = JSON.stringify(value) ?? "";
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
  }

  it("returns only the wallet address for a profile.read mini app", async () => {
    const bridge = createMiniAppBridge({
      // The least privileged permission in the model.
      permissions: ["profile.read"],
      requestUserApproval: async () => true,
    });

    const result = await bridge.call("profile.get");

    expect(result).toEqual({ address: ADDRESS, username: null });
    expect(Object.keys(result as object)).toEqual(["address", "username"]);
    expectNoSecrets(result);
  });

  it("does not expose the auth token even when the keychain holds one", async () => {
    // The keychain genuinely contains a token for this user.
    (SecureStore.setItemAsync as jest.Mock).mockImplementation(
      async (key: string, value: string) => {
        store[key] = value;
      }
    );
    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      const item = store[key];
      return item === undefined ? null : item;
    });

    const bridge = createMiniAppBridge({
      permissions: ["profile.read"],
      requestUserApproval: async () => true,
    });

    const result = await bridge.call("profile.get");
    const serialized = JSON.stringify(result) ?? "";

    expect(serialized).not.toContain("auth_token");
    for (const secret of SECRETS) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(result as object)).not.toContain("creatorToken");
  });

  it("strips secret-shaped fields a host handler tries to return", async () => {
    const bridge = createMiniAppBridge({
      permissions: ["profile.read", "post.create", "profile.update"],
      requestUserApproval: async () => true,
      handlers: {
        "profile.get": async () => ({
          address: ADDRESS,
          authToken: SECRETS[0],
          nested: { access_token: SECRETS[1], safe: "ok" },
          list: [{ apiKey: SECRETS[0] }],
        }),
        "post.create": async () => ({ postId: 7, authorization: `Bearer ${SECRETS[0]}` }),
        "profile.update": async () => ({ username: "maya", privateKey: SECRETS[0] }),
      },
    });

    for (const method of ["profile.get", "post.create", "profile.update"]) {
      const result = await bridge.call(method, {});
      expectNoSecrets(result);
    }

    await expect(bridge.call("profile.get", {})).resolves.toEqual({
      address: ADDRESS,
      nested: { safe: "ok" },
      list: [{}],
    });
  });
});
