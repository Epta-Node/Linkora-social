/**
 * Ambient module declarations for optional Ledger peer dependencies.
 *
 * These packages are listed as optional peerDependencies in package.json.
 * They are loaded at runtime via dynamic import() inside ledger.ts, so they
 * are never required at install time. However, TypeScript still resolves
 * module specifiers at compile time and raises TS2307 ("Cannot find module")
 * when the packages are absent (e.g. in CI environments without libusb /
 * node-gyp build tools).
 *
 * Declaring the modules here gives TypeScript enough type information to
 * compile cleanly without the native packages being installed. The shapes
 * reflect exactly what ledger.ts consumes — nothing more.
 *
 * Location: packages/sdk/src/types/ledger-modules.d.ts
 */

// ---------------------------------------------------------------------------
// @ledgerhq/hw-transport-webhid
// Browser transport over the WebHID API.
// ledger.ts usage: TransportWebHID.create() → LedgerTransport
// ---------------------------------------------------------------------------
declare module "@ledgerhq/hw-transport-webhid" {
  interface Transport {
    close(): Promise<void>;
  }

  interface TransportWebHIDConstructor {
    create(): Promise<Transport>;
  }

  const TransportWebHID: TransportWebHIDConstructor;
  export default TransportWebHID;
}

// ---------------------------------------------------------------------------
// @ledgerhq/hw-transport-node-hid
// Node.js transport over the native USB HID layer (requires libusb + node-gyp).
// ledger.ts usage: TransportNodeHID.list() → unknown[], .open(device) → LedgerTransport
// ---------------------------------------------------------------------------
declare module "@ledgerhq/hw-transport-node-hid" {
  interface Transport {
    close(): Promise<void>;
  }

  interface TransportNodeHIDConstructor {
    list(): Promise<unknown[]>;
    open(device: unknown): Promise<Transport>;
  }

  const TransportNodeHID: TransportNodeHIDConstructor;
  export default TransportNodeHID;
}

// ---------------------------------------------------------------------------
// @ledgerhq/hw-app-str
// Stellar application bindings for a Ledger transport.
// ledger.ts usage:
//   new StrApp(transport)
//   app.getPublicKey(path)   → { publicKey?: string; rawPublicKey: Buffer }
//   app.signTransaction(path, txBytes) → { signature: Buffer }
// ---------------------------------------------------------------------------
declare module "@ledgerhq/hw-app-str" {
  interface Transport {
    close(): Promise<void>;
  }

  interface PublicKeyResult {
    publicKey?: string;
    rawPublicKey: Buffer;
  }

  interface SignatureResult {
    signature: Buffer;
  }

  class Str {
    constructor(transport: Transport);
    getPublicKey(derivationPath: string): Promise<PublicKeyResult>;
    signTransaction(
      derivationPath: string,
      txBytes: Buffer
    ): Promise<SignatureResult>;
  }

  export default Str;
}
