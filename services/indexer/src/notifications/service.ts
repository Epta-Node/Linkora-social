import { Pool } from "pg";

export type NotificationEventType = "FOLLOW" | "TIP_RECEIVED" | "LIKE_RECEIVED";

export interface DeviceTokenRecord {
  address: string;
  token: string;
  platform: string;
  createdAt: string;
}

export interface DeviceTokenStore {
  register(address: string, token: string, platform: string): Promise<void>;
  getToken(address: string): Promise<string | null>;
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
}

export class NotificationService {
  private deviceTokenStore: DeviceTokenStore;
  private sendPush: (message: Record<string, unknown>) => Promise<unknown>;

  constructor(options: NotificationServiceOptions = {}) {
    this.deviceTokenStore =
      options.deviceTokenStore ?? new MemoryDeviceTokenStore(options.deviceTokens ?? new Map());
    this.sendPush = options.sendPush ?? this.defaultSendPush;
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

  async dispatchEventNotification(options: NotificationDispatchOptions): Promise<boolean> {
    const token = await this.getDeviceToken(options.recipient);
    if (!token) {
      return false;
    }

    const title = this.getTitle(options.type);
    const body = this.getBody(options.type, options.payload);
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
}

export const defaultNotificationService = new NotificationService();
