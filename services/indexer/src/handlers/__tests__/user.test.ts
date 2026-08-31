import {
  handleBlock,
  handleUnblock,
  handleDmKeyPublished,
  BlockEvent,
  UnblockEvent,
  DmKeyPublishedEvent,
} from "../user";
import { Database } from "../../db";

jest.mock("../../db");

function makeMockDb(): jest.Mocked<Database> {
  return {
    insertBlock: jest.fn().mockResolvedValue(undefined),
    deleteBlock: jest.fn().mockResolvedValue(undefined),
    getBlockedUsers: jest.fn(),
    upsertDmKey: jest.fn().mockResolvedValue(undefined),
    getDmKey: jest.fn(),
  } as unknown as jest.Mocked<Database>;
}

describe("user event handlers", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = makeMockDb();
  });

  describe("handleBlock", () => {
    it("calls db.insertBlock with correct fields on happy path", async () => {
      const event: BlockEvent = {
        blocker: "GBLOCKER123",
        blocked: "GBLOCKED456",
      };

      await handleBlock(db, event);

      expect(db.insertBlock).toHaveBeenCalledTimes(1);
      expect(db.insertBlock).toHaveBeenCalledWith({
        blocker: "GBLOCKER123",
        blocked: "GBLOCKED456",
      });
    });

    it("throws when blocker field is missing", async () => {
      const event = {
        blocker: "",
        blocked: "GBLOCKED456",
      } as BlockEvent;

      await expect(handleBlock(db, event)).rejects.toThrow(
        "Block event missing required field: blocker"
      );
      expect(db.insertBlock).not.toHaveBeenCalled();
    });

    it("throws when blocked field is missing", async () => {
      const event = {
        blocker: "GBLOCKER123",
        blocked: "",
      } as BlockEvent;

      await expect(handleBlock(db, event)).rejects.toThrow(
        "Block event missing required field: blocked"
      );
      expect(db.insertBlock).not.toHaveBeenCalled();
    });

    it("propagates database errors", async () => {
      db.insertBlock.mockRejectedValueOnce(new Error("DB write failed"));

      const event: BlockEvent = {
        blocker: "GBLOCKER123",
        blocked: "GBLOCKED456",
      };

      await expect(handleBlock(db, event)).rejects.toThrow("DB write failed");
    });
  });

  describe("handleUnblock", () => {
    it("calls db.deleteBlock with correct fields on happy path", async () => {
      const event: UnblockEvent = {
        blocker: "GBLOCKER123",
        blocked: "GBLOCKED456",
      };

      await handleUnblock(db, event);

      expect(db.deleteBlock).toHaveBeenCalledTimes(1);
      expect(db.deleteBlock).toHaveBeenCalledWith("GBLOCKER123", "GBLOCKED456");
    });

    it("throws when blocker field is missing", async () => {
      const event = {
        blocker: "",
        blocked: "GBLOCKED456",
      } as UnblockEvent;

      await expect(handleUnblock(db, event)).rejects.toThrow(
        "Unblock event missing required field: blocker"
      );
      expect(db.deleteBlock).not.toHaveBeenCalled();
    });

    it("throws when blocked field is missing", async () => {
      const event = {
        blocker: "GBLOCKER123",
        blocked: "",
      } as UnblockEvent;

      await expect(handleUnblock(db, event)).rejects.toThrow(
        "Unblock event missing required field: blocked"
      );
      expect(db.deleteBlock).not.toHaveBeenCalled();
    });

    it("propagates database errors", async () => {
      db.deleteBlock.mockRejectedValueOnce(new Error("DB delete failed"));

      const event: UnblockEvent = {
        blocker: "GBLOCKER123",
        blocked: "GBLOCKED456",
      };

      await expect(handleUnblock(db, event)).rejects.toThrow("DB delete failed");
    });
  });

  describe("handleDmKeyPublished", () => {
    it("calls db.upsertDmKey with correct fields on happy path", async () => {
      const event: DmKeyPublishedEvent = {
        address: "GUSER123",
        x25519_pubkey: "abc123hex",
      };

      await handleDmKeyPublished(db, event);

      expect(db.upsertDmKey).toHaveBeenCalledTimes(1);
      expect(db.upsertDmKey).toHaveBeenCalledWith({
        address: "GUSER123",
        x25519_pubkey: "abc123hex",
      });
    });

    it("throws when address field is missing", async () => {
      const event = {
        address: "",
        x25519_pubkey: "abc123hex",
      } as DmKeyPublishedEvent;

      await expect(handleDmKeyPublished(db, event)).rejects.toThrow(
        "DmKeyPublished event missing required field: address"
      );
      expect(db.upsertDmKey).not.toHaveBeenCalled();
    });

    it("throws when x25519_pubkey field is missing", async () => {
      const event = {
        address: "GUSER123",
        x25519_pubkey: "",
      } as DmKeyPublishedEvent;

      await expect(handleDmKeyPublished(db, event)).rejects.toThrow(
        "DmKeyPublished event missing required field: x25519_pubkey"
      );
      expect(db.upsertDmKey).not.toHaveBeenCalled();
    });

    it("propagates database errors", async () => {
      db.upsertDmKey.mockRejectedValueOnce(new Error("DB upsert failed"));

      const event: DmKeyPublishedEvent = {
        address: "GUSER123",
        x25519_pubkey: "abc123hex",
      };

      await expect(handleDmKeyPublished(db, event)).rejects.toThrow("DB upsert failed");
    });
  });
});
