import { createMiniAppBridge } from "../bridge";
import { BridgeError } from "../permissions";

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
