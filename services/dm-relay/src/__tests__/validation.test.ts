import {
  DEFAULT_MAX_MESSAGE_BYTES,
  getMaxMessageBytes,
  createSendMessageSchema,
  SendMessageSchema,
} from "../validation";
import { registerWsClient } from "../routes";
import { EventEmitter } from "events";
import { WebSocket } from "ws";

describe("DM relay validation & size limits", () => {
  const validSender = "GA2C5RFPE6GCKMY3ZVUHSAGCC6ESC4BVGXRODVXKZAWY2R3ZDG6ST3V4";
  const validRecipient = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
  const validSignature = "a".repeat(128);

  describe("getMaxMessageBytes", () => {
    it("returns default when no env var is set", () => {
      expect(getMaxMessageBytes({})).toBe(DEFAULT_MAX_MESSAGE_BYTES);
    });

    it("parses MAX_MESSAGE_BYTES from env", () => {
      expect(getMaxMessageBytes({ MAX_MESSAGE_BYTES: "1024" })).toBe(1024);
    });

    it("parses MAX_MESSAGE_SIZE from env fallback", () => {
      expect(getMaxMessageBytes({ MAX_MESSAGE_SIZE: "2048" })).toBe(2048);
    });

    it("falls back to default for invalid number", () => {
      expect(getMaxMessageBytes({ MAX_MESSAGE_BYTES: "invalid" })).toBe(
        DEFAULT_MAX_MESSAGE_BYTES
      );
      expect(getMaxMessageBytes({ MAX_MESSAGE_BYTES: "-50" })).toBe(
        DEFAULT_MAX_MESSAGE_BYTES
      );
    });
  });

  describe("SendMessageSchema & createSendMessageSchema", () => {
    it("accepts valid message within limit", () => {
      const validPayload = {
        sender: validSender,
        recipient: validRecipient,
        ciphertext_b64: Buffer.from("Hello, World!").toString("base64"),
        message_index: 0,
        timestamp: Date.now(),
        signature: validSignature,
      };

      const result = SendMessageSchema.safeParse(validPayload);
      expect(result.success).toBe(true);
    });

    it("rejects ciphertext exceeding custom max size cap", () => {
      const smallSchema = createSendMessageSchema(10); // 10 bytes max
      const largePayload = {
        sender: validSender,
        recipient: validRecipient,
        ciphertext_b64: Buffer.from("This is a message longer than 10 bytes").toString("base64"),
        message_index: 0,
        timestamp: Date.now(),
        signature: validSignature,
      };

      const result = smallSchema.safeParse(largePayload);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain("Ciphertext size exceeds maximum allowed size");
      }
    });

    it("rejects oversized base64 ciphertext exceeding default max bytes", () => {
      const oversizedBuffer = Buffer.alloc(DEFAULT_MAX_MESSAGE_BYTES + 100, 0x41);
      const oversizedPayload = {
        sender: validSender,
        recipient: validRecipient,
        ciphertext_b64: oversizedBuffer.toString("base64"),
        message_index: 0,
        timestamp: Date.now(),
        signature: validSignature,
      };

      const result = SendMessageSchema.safeParse(oversizedPayload);
      expect(result.success).toBe(false);
    });
  });

  describe("WebSocket frame size enforcement", () => {
    class MockWebSocket extends EventEmitter {
      readyState = WebSocket.OPEN;
      close = jest.fn();
      send = jest.fn();
    }

    it("accepts frames within maxMessageBytes limit", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      registerWsClient(validSender, ws, undefined, 1024);

      const validFrame = JSON.stringify({ type: "typing_status", recipient: validRecipient });
      (ws as unknown as MockWebSocket).emit("message", Buffer.from(validFrame));

      expect((ws as any).close).not.toHaveBeenCalled();
    });

    it("rejects and closes connection with code 1009 when frame exceeds maxMessageBytes", () => {
      const ws = new MockWebSocket() as unknown as WebSocket;
      const maxBytes = 50;
      registerWsClient(validSender, ws, undefined, maxBytes);

      const oversizedFrame = Buffer.alloc(100, "a");
      (ws as unknown as MockWebSocket).emit("message", oversizedFrame);

      expect((ws as any).close).toHaveBeenCalledWith(1009, "Message too large");
    });
  });
});
