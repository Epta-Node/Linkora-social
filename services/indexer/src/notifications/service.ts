import { Pool } from "pg";

export interface NotificationPreferences {
  address: string;
  follow_notifications: boolean;
  tip_notifications: boolean;
  like_notifications: boolean;
  moderation_notifications: boolean;
  governance_notifications: boolean;
  pool_notifications: boolean;
  post_notifications: boolean;
}

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

export interface PreferencesStore {
  getPreferences(address: string): Promise<NotificationPreferences | null>;
  setPreferences(address: string, prefs: Omit<NotificationPreferences, "address">): Promise<void>;
}

export interface NotificationServiceOptions {
  sendPush?: (message: Record<string, unknown>) => Promise<unknown>;
  deviceTokens?: Map<string, { token: string; platform: string; createdAt: string }>;
  deviceTokenStore?: DeviceTokenStore;
  preferencesStore?: PreferencesStore;
}

export class NotificationService {
  private deviceTokenStore: DeviceTokenStore;
  private preferencesStore: PreferencesStore;
  private sendPush: (message: Record<string, unknown>) => Promise<unknown>;

  constructor(options: NotificationServiceOptions = {}) {
    this.deviceTokenStore =
      options.deviceTokenStore ?? new MemoryDeviceTokenStore(options.deviceTokens ?? new Map());
    this.preferencesStore = options.preferencesStore ?? new MemoryPreferencesStore();
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

  async deregisterDeviceToken(address: string): Promise<void> {
    if (!address) {
      return;
    }

    await this.deviceTokenStore.removeToken(address);
  }

  async getPreferences(address: string): Promise<NotificationPreferences | null> {
    if (!address) {
      return null;
    }

    return this.preferencesStore.getPreferences(address);
  }

  async setPreferences(
    address: string,
    prefs: Omit<NotificationPreferences, "address">
  ): Promise<void> {
    if (!address) {
      return;
    }

    await this.preferencesStore.setPreferences(address, prefs);
  }

  async dispatchEventNotification(options: NotificationDispatchOptions): Promise<boolean> {
    const prefs = await this.getPreferences(options.recipient);
    if (prefs && !this.isNotificationEnabled(prefs, options.type)) {
      return false;
    }

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

  isNotificationEnabled(prefs: NotificationPreferences, type: NotificationEventType): boolean {
    switch (type) {
      case "FOLLOW":
        return prefs.follow_notifications;
      case "TIP_RECEIVED":
        return prefs.tip_notifications;
      case "LIKE_RECEIVED":
        return prefs.like_notifications;
      case "POST_REPORTED":
      case "REPORT_DISMISSED":
      case "POST_REMOVED_BY_MODERATION":
        return prefs.moderation_notifications;
      default:
        return true;
    }
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

export class MemoryPreferencesStore implements PreferencesStore {
  private readonly store = new Map<string, NotificationPreferences>();

  async getPreferences(address: string): Promise<NotificationPreferences | null> {
    return this.store.get(address) ?? null;
  }

  async setPreferences(
    address: string,
    prefs: Omit<NotificationPreferences, "address">
  ): Promise<void> {
    this.store.set(address, { address, ...prefs });
  }
}

export class PostgresPreferencesStore implements PreferencesStore {
  constructor(private readonly pool: Pool) {}

  async getPreferences(address: string): Promise<NotificationPreferences | null> {
    const res = await this.pool.query<NotificationPreferences>(
      `
      SELECT address, follow_notifications, tip_notifications, like_notifications,
             moderation_notifications, governance_notifications, pool_notifications,
             post_notifications
      FROM notification_preferences
      WHERE address = $1
      `,
      [address]
    );

    return res.rows[0] ?? null;
  }

  async setPreferences(
    address: string,
    prefs: Omit<NotificationPreferences, "address">
  ): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO notification_preferences
        (address, follow_notifications, tip_notifications, like_notifications,
         moderation_notifications, governance_notifications, pool_notifications,
         post_notifications, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (address) DO UPDATE SET
        follow_notifications = EXCLUDED.follow_notifications,
        tip_notifications = EXCLUDED.tip_notifications,
        like_notifications = EXCLUDED.like_notifications,
        moderation_notifications = EXCLUDED.moderation_notifications,
        governance_notifications = EXCLUDED.governance_notifications,
        pool_notifications = EXCLUDED.pool_notifications,
        post_notifications = EXCLUDED.post_notifications,
        updated_at = NOW()
      `,
      [
        address,
        prefs.follow_notifications,
        prefs.tip_notifications,
        prefs.like_notifications,
        prefs.moderation_notifications,
        prefs.governance_notifications,
        prefs.pool_notifications,
        prefs.post_notifications,
      ]
    );
  }
}

export const defaultNotificationService = new NotificationService();
