import { Pool } from "pg";

export type NotificationEventType =
  | "FOLLOW"
  | "TIP_RECEIVED"
  | "LIKE_RECEIVED"
  | "POST_REPORTED"
  | "REPORT_DISMISSED"
  | "POST_REMOVED_BY_MODERATION";

export interface DeviceTokenRecord {
  address: string;
  token: string;
  platform: string;
  createdAt: string;
}

export interface DeviceTokenStore {
  register(address: string, token: string, platform: string): Promise<void>;
  getToken(address: string): Promise<string | null>;
  removeToken(address: string): Promise<void>;
}

export interface NotificationDispatchOptions {
  type: NotificationEventType;
  recipient: string;
  payload?: Record<string, unknown>;
}

export interface NotificationServiceOptions {
  sendPush?: (message: Record<string, unknown>) => Promise<unknown>;
  deviceTokens?: Map<string, { token: string; platform: string; createdAt: string }>;
  deviceTokenStore?: DeviceTokenStore;
  pool?: Pool;
}

export class NotificationService {
  private deviceTokenStore: DeviceTokenStore;
  private sendPush: (message: Record<string, unknown>) => Promise<unknown>;
  private pool?: Pool;

  constructor(options: NotificationServiceOptions = {}) {
    this.deviceTokenStore =
      options.deviceTokenStore ?? new MemoryDeviceTokenStore(options.deviceTokens ?? new Map());
    this.sendPush = options.sendPush ?? this.defaultSendPush;
    this.pool = options.pool;
  }

  async registerDeviceToken(address: string, token: string, platform: string): Promise<void> {
    if (!address || !token) {
      return;
    }

    await this.deviceTokenStore.register(address, token, platform);
  }

  async getDeviceToken(address: string): Promise<string | null> {
    return this.deviceTokenStore.getToken(address);
  }

  async deregisterDeviceToken(address: string): Promise<void> {
    if (!address) {
      return;
    }

    await this.deviceTokenStore.removeToken(address);
  }

  async getPreferences(address: string): Promise<any | null> {
    if (!this.pool) {
      return null;
    }
    const res = await this.pool.query(
      `SELECT
        browser_push_enabled as "browserPushEnabled",
        new_followers as "newFollowers",
        new_likes as "newLikes",
        new_comments as "newComments",
        direct_messages as "directMessages",
        pool_activity as "poolActivity",
        governance_updates as "governanceUpdates"
       FROM notification_preferences
       WHERE address = $1`,
      [address]
    );
    if (res.rows.length === 0) {
      return null;
    }
    return res.rows[0];
  }

  async savePreferences(
    address: string,
    prefs: {
      browserPushEnabled: boolean;
      newFollowers: boolean;
      newLikes: boolean;
      newComments: boolean;
      directMessages: boolean;
      poolActivity: boolean;
      governanceUpdates: boolean;
    }
  ): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      `INSERT INTO notification_preferences (
        address, browser_push_enabled, new_followers, new_likes, new_comments, direct_messages, pool_activity, governance_updates, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (address) DO UPDATE SET
        browser_push_enabled = EXCLUDED.browser_push_enabled,
        new_followers = EXCLUDED.new_followers,
        new_likes = EXCLUDED.new_likes,
        new_comments = EXCLUDED.new_comments,
        direct_messages = EXCLUDED.direct_messages,
        pool_activity = EXCLUDED.pool_activity,
        governance_updates = EXCLUDED.governance_updates,
        updated_at = NOW()`,
      [
        address,
        prefs.browserPushEnabled,
        prefs.newFollowers,
        prefs.newLikes,
        prefs.newComments,
        prefs.directMessages,
        prefs.poolActivity,
        prefs.governanceUpdates,
      ]
    );
  }

  async shouldSendNotification(recipient: string, type: NotificationEventType): Promise<boolean> {
    const prefs = await this.getPreferences(recipient);
    if (!prefs) {
      return true;
    }

    switch (type) {
      case "FOLLOW":
        return prefs.newFollowers;
      case "LIKE_RECEIVED":
        return prefs.newLikes;
      case "TIP_RECEIVED":
        return prefs.poolActivity;
      case "POST_REPORTED":
      case "REPORT_DISMISSED":
      case "POST_REMOVED_BY_MODERATION":
        return prefs.governanceUpdates;
      default:
        return true;
    }
  }

  async dispatchEventNotification(options: NotificationDispatchOptions): Promise<boolean> {
    const shouldSend = await this.shouldSendNotification(options.recipient, options.type);
    if (!shouldSend) {
      return false;
    }

    const token = await this.getDeviceToken(options.recipient);
    if (!token) {
      return false;
    }

    const title = this.getTitle(options.type);
    const body = this.getBody(options.type, options.payload);

    if (token.startsWith("{")) {
      // Parse Web Push subscription and log sending of notification
      console.log(
        `[web-push] Sending push notification to web user ${options.recipient}: title="${title}", body="${body}"`
      );
      return true;
    }

    const data = { ...options.payload, type: this.getMobileType(options.type) };

    await this.sendPush({
      to: token,
      title,
      body,
      sound: "default",
      data,
    });

    return true;
  }

  private async defaultSendPush(message: Record<string, unknown>): Promise<unknown> {
    const accessToken = process.env.EXPO_PUSH_ACCESS_TOKEN;
    if (!accessToken) {
      return null;
    }

    return fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(message),
    });
  }

  private getTitle(type: NotificationEventType): string {
    switch (type) {
      case "FOLLOW":
        return "New follower";
      case "TIP_RECEIVED":
        return "Tip received";
      case "LIKE_RECEIVED":
        return "Your post was liked";
      case "POST_REPORTED":
        return "Your post was reported";
      case "REPORT_DISMISSED":
        return "Report dismissed";
      case "POST_REMOVED_BY_MODERATION":
        return "Post removed by moderation";
      default:
        return "Linkora update";
    }
  }

  private getMobileType(type: NotificationEventType): string {
    return type === "FOLLOW" ? "NEW_FOLLOWER" : type;
  }

  private getBody(type: NotificationEventType, payload?: Record<string, unknown>): string {
    switch (type) {
      case "FOLLOW":
        return `A new follower started following you${payload?.followerAddress ? ` (${String(payload.followerAddress)})` : ""}`;
      case "TIP_RECEIVED":
        return `You received a tip${payload?.postId ? ` on post ${String(payload.postId)}` : ""}`;
      case "LIKE_RECEIVED":
        return `A user liked your post${payload?.postId ? ` ${String(payload.postId)}` : ""}`;
      case "POST_REPORTED":
        return `Your post was reported${payload?.reason ? ` for: ${String(payload.reason)}` : ""}`;
      case "REPORT_DISMISSED":
        return `Your report was dismissed${payload?.moderatorNotes ? `: ${String(payload.moderatorNotes)}` : ""}`;
      case "POST_REMOVED_BY_MODERATION":
        return `Your post was removed by moderation${payload?.reason ? `: ${String(payload.reason)}` : ""}`;
      default:
        return "You have a new notification";
    }
  }
}

export class MemoryDeviceTokenStore implements DeviceTokenStore {
  constructor(
    private readonly deviceTokens: Map<
      string,
      { token: string; platform: string; createdAt: string }
    >
  ) {}

  async register(address: string, token: string, platform: string): Promise<void> {
    this.deviceTokens.set(address, {
      token,
      platform,
      createdAt: new Date().toISOString(),
    });
  }

  async getToken(address: string): Promise<string | null> {
    return this.deviceTokens.get(address)?.token ?? null;
  }

  async removeToken(address: string): Promise<void> {
    this.deviceTokens.delete(address);
  }
}

export class PostgresDeviceTokenStore implements DeviceTokenStore {
  constructor(private readonly pool: Pool) {}

  async register(address: string, token: string, platform: string): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO device_tokens (address, token, platform, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (address, token) DO UPDATE SET
        platform = EXCLUDED.platform,
        updated_at = NOW()
      `,
      [address, token, platform]
    );
  }

  async getToken(address: string): Promise<string | null> {
    const res = await this.pool.query(
      `
      SELECT token
      FROM device_tokens
      WHERE address = $1
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [address]
    );

    return (res.rows[0]?.token as string | undefined) ?? null;
  }

  async removeToken(address: string): Promise<void> {
    await this.pool.query(
      `
      DELETE FROM device_tokens
      WHERE address = $1
      `,
      [address]
    );
  }
}

export const defaultNotificationService = new NotificationService();
