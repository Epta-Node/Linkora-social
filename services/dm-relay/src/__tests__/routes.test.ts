/**
 * Unit tests for WebSocket route handling and InflightCounter integration.
 *
 * Verifies that:
 *  - WebSocket writes increment inflight counter during dispatch and decrement upon completion.
 *  - Rejecting ws.send calls (e.g. EPIPE or send-after-close errors) do not leak counter state.
 *  - inflightCounter.drain() resolves promptly even when ws.send fails.
 */

import { EventEmitter } from "events";
import { WebSocket } from "ws";
import { registerWsClient } from "../routes";
import { InflightCounter } from "../inflight-counter";
import { Keypair } from "@stellar/stellar-sdk";

class MockWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  close = jest.fn();
  send = jest.fn();
}

describe("registerWsClient and inflight counter error handling", () => {
  let senderAddress: string;
  let recipientAddress: string;
  let senderWs: MockWebSocket;
  let recipientWs: MockWebSocket;
  let inflightCounter: InflightCounter;

  beforeEach(() => {
    senderAddress = Keypair.random().publicKey();
    recipientAddress = Keypair.random().publicKey();

    senderWs = new MockWebSocket();
    recipientWs = new MockWebSocket();
    inflightCounter = new InflightCounter();

    registerWsClient(senderAddress, senderWs as unknown as WebSocket, inflightCounter);
    registerWsClient(recipientAddress, recipientWs as unknown as WebSocket, inflightCounter);
  });

  afterEach(() => {
    senderWs.emit("close");
    recipientWs.emit("close");
  });

  it("decrements inflight counter and resolves drain() when ws.send fails with an EPIPE error", async () => {
    const epipeError = new Error("EPIPE: broken pipe");
    recipientWs.send.mockImplementation((_data: string, cb?: (err?: Error) => void) => {
      if (cb) cb(epipeError);
    });

    expect(inflightCounter.value).toBe(0);

    const typingPayload = JSON.stringify({
      type: "typing_status",
      sender: senderAddress,
      recipient: recipientAddress,
    });

    senderWs.emit("message", Buffer.from(typingPayload));

    // Wait for async message listener processing to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(recipientWs.send).toHaveBeenCalledTimes(1);
    expect(inflightCounter.value).toBe(0);

    // drain() must resolve promptly without hanging
    await expect(inflightCounter.drain()).resolves.toBeUndefined();
  });

  it("decrements inflight counter and resolves drain() when ws.send throws synchronously", async () => {
    recipientWs.send.mockImplementation(() => {
      throw new Error("send-after-close");
    });

    expect(inflightCounter.value).toBe(0);

    const typingPayload = JSON.stringify({
      type: "typing_status",
      sender: senderAddress,
      recipient: recipientAddress,
    });

    senderWs.emit("message", Buffer.from(typingPayload));

    await new Promise((r) => setTimeout(r, 50));

    expect(recipientWs.send).toHaveBeenCalledTimes(1);
    expect(inflightCounter.value).toBe(0);

    await expect(inflightCounter.drain()).resolves.toBeUndefined();
  });

  it("decrements inflight counter and resolves drain() on successful ws.send", async () => {
    recipientWs.send.mockImplementation((_data: string, cb?: (err?: Error) => void) => {
      if (cb) cb();
    });

    expect(inflightCounter.value).toBe(0);

    const typingPayload = JSON.stringify({
      type: "typing_status",
      sender: senderAddress,
      recipient: recipientAddress,
    });

    senderWs.emit("message", Buffer.from(typingPayload));

    await new Promise((r) => setTimeout(r, 50));

    expect(recipientWs.send).toHaveBeenCalledTimes(1);
    expect(inflightCounter.value).toBe(0);

    await expect(inflightCounter.drain()).resolves.toBeUndefined();
  });
});
