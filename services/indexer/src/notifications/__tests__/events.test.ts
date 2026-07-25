import { nativeToScVal } from "@stellar/stellar-sdk";
import { dispatchNotificationForBusEvent, parseNotificationEvent } from "../events";
import { BusEvent } from "../../bus";
import { NotificationService } from "../service";

function enc(value: unknown): string {
  return nativeToScVal(value).toXDR("base64");
}

function busEvent(type: string, data: Record<string, unknown>): BusEvent {
  return {
    type,
    ledgerSequence: 42,
    eventIndex: 0,
    contractId: "CONTRACT",
    topic: [enc(type)],
    data: { value: enc(data) },
  };
}

describe("notification event projector", () => {
  it("parses follow events from bus payloads", () => {
    expect(
      parseNotificationEvent(
        busEvent("follow", {
          follower: "GFOLLOWER",
          followee: "GFOLLOWEE",
        })
      )
    ).toEqual({
      type: "follow",
      follower: "GFOLLOWER",
      followee: "GFOLLOWEE",
    });
  });

  it("dispatches tip notifications to post authors", async () => {
    const sendPush = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService({ sendPush });
    await service.registerDeviceToken("GAUTHOR", "ExpoPushToken[token-1]", "ios");

    const callLog: string[] = [];
    const pool = {
      query: jest.fn(async (sql: string, _params?: unknown[]) => {
        callLog.push(sql);
        if (sql.includes("sent_notifications") && sql.includes("SELECT")) {
          return { rows: [] };
        }
        if (sql.includes("sent_notifications") && sql.includes("INSERT")) {
          return { rows: [] };
        }
        if (sql.includes("SELECT author FROM posts")) {
          return { rows: [{ author: "GAUTHOR" }] };
        }
        return { rows: [] };
      }),
    };

    await dispatchNotificationForBusEvent(
      pool as never,
      service,
      busEvent("tip", {
        tipper: "GTIPPER",
        post_id: 42,
        amount: "1000000",
      })
    );

    expect(callLog.some((s) => s.includes("SELECT author FROM posts"))).toBe(true);
    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ExpoPushToken[token-1]",
        data: expect.objectContaining({
          type: "TIP_RECEIVED",
          postId: "42",
          deepLink: "linkora://post/42",
        }),
      })
    );
  });

  it("dispatches follow notifications directly to the followee", async () => {
    const sendPush = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService({ sendPush });
    await service.registerDeviceToken("GFOLLOWEE", "ExpoPushToken[token-2]", "ios");

    await dispatchNotificationForBusEvent(
      {
        query: jest.fn().mockResolvedValue({ rows: [] }),
      } as never,
      service,
      busEvent("follow", {
        follower: "GFOLLOWER",
        followee: "GFOLLOWEE",
      })
    );

    expect(sendPush).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "ExpoPushToken[token-2]",
        data: expect.objectContaining({
          type: "NEW_FOLLOWER",
          deepLink: "linkora://profile/GFOLLOWER",
        }),
      })
    );
  });

  it("skips dispatch when notification is already recorded (idempotent re-ingest)", async () => {
    const sendPush = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService({ sendPush });
    await service.registerDeviceToken("GFOLLOWEE", "ExpoPushToken[token-2]", "ios");

    await dispatchNotificationForBusEvent(
      {
        query: jest.fn().mockResolvedValue({ rows: [{ dispatch_key: "42000|follow|GFOLLOWEE" }] }),
      } as never,
      service,
      busEvent("follow", {
        follower: "GFOLLOWER",
        followee: "GFOLLOWEE",
      })
    );

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("does not dispatch notification when the recipient is the same as the actor (self-tip)", async () => {
    const sendPush = jest.fn().mockResolvedValue(undefined);
    const service = new NotificationService({ sendPush });
    await service.registerDeviceToken("GTIPPER", "ExpoPushToken[token-self]", "ios");

    await dispatchNotificationForBusEvent(
      {
        query: jest.fn().mockResolvedValue({ rows: [{ author: "GTIPPER" }] }),
      } as never,
      service,
      busEvent("tip", {
        tipper: "GTIPPER",
        post_id: 42,
        amount: "1000000",
      })
    );

    expect(sendPush).not.toHaveBeenCalled();
  });
});
