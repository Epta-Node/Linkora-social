import { createNotificationInboxRouter, INBOX_QUERY } from "../notificationInbox";
import { decodeTimestampCursor, encodeCursor } from "../cursor";

jest.mock("../../../middleware/stellarAuth", () => ({
  requireStellarAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.context = { stellarAddress: (req.headers as Record<string, string>)["x-test-address"] };
    next();
  },
}));

jest.mock("../../../middleware/rateLimit", () => ({
  rateLimitWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const RECIPIENT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const FOLLOWER = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
}

/** Runs a route's middleware chain and resolves once the final handler settles. */
async function invoke(
  pg: { query: jest.Mock },
  method: "get" | "post",
  path: string,
  req: Record<string, unknown>
) {
  const router = createNotificationInboxRouter(pg as never);
  const layer = router.stack.find(
    (item: any) => item.route?.path === path && item.route.methods[method]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
  const res = mockResponse();
  const handlers = layer.route.stack.map((s: { handle: Function }) => s.handle);
  const request = { headers: {}, query: {}, params: {}, body: {}, ...req };
  for (const handler of handlers) {
    let proceeded = false;
    await handler(request, res, () => {
      proceeded = true;
    });
    if (!proceeded) break;
  }
  return res;
}

function row(id: string, createdAt: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: id.split(":")[0],
    actor: FOLLOWER,
    post_id: null,
    amount: null,
    excerpt: null,
    created_at: new Date(createdAt),
    read: false,
    ...extra,
  };
}

describe("GET /api/notifications/inbox/:address", () => {
  it("returns a page with a composite cursor when more rows exist", async () => {
    const pg = {
      query: jest.fn().mockResolvedValue({
        rows: [
          row(`tip:abc123`, "2026-05-02T10:00:00Z", {
            post_id: "7",
            amount: "15000000",
            excerpt: "gm",
          }),
          row(`follow:${FOLLOWER}`, "2026-05-01T10:00:00Z", { read: true }),
          row(`like:7:${FOLLOWER}`, "2026-04-30T10:00:00Z"),
        ],
      }),
    };

    const res = await invoke(pg, "get", "/:address", {
      params: { address: RECIPIENT },
      query: { limit: "2" },
    });

    expect(pg.query).toHaveBeenCalledWith(INBOX_QUERY, [RECIPIENT, null, null, 3]);
    const body = res.json.mock.calls[0][0];
    expect(body.notifications).toEqual([
      {
        id: "tip:abc123",
        type: "tip",
        actor: FOLLOWER,
        post_id: 7,
        amount: "15000000",
        excerpt: "gm",
        created_at: "2026-05-02T10:00:00.000Z",
        read: false,
      },
      expect.objectContaining({ id: `follow:${FOLLOWER}`, post_id: null, read: true }),
    ]);
    expect(body.has_more).toBe(true);
    expect(decodeTimestampCursor(body.next_cursor)).toEqual({
      value: new Date("2026-05-01T10:00:00Z"),
      id: `follow:${FOLLOWER}`,
    });
  });

  it("passes a decoded cursor to the keyset predicate and ends without a cursor", async () => {
    const pg = {
      query: jest
        .fn()
        .mockResolvedValue({ rows: [row(`like:7:${FOLLOWER}`, "2026-04-30T10:00:00Z")] }),
    };
    const cursor = encodeCursor("2026-05-01T10:00:00.000Z", `follow:${FOLLOWER}`);

    const res = await invoke(pg, "get", "/:address", {
      params: { address: RECIPIENT },
      query: { cursor },
    });

    expect(pg.query).toHaveBeenCalledWith(INBOX_QUERY, [
      RECIPIENT,
      "2026-05-01T10:00:00.000Z",
      `follow:${FOLLOWER}`,
      21,
    ]);
    expect(res.json.mock.calls[0][0]).toMatchObject({ has_more: false, next_cursor: null });
  });

  it("rejects malformed cursors and addresses with 400", async () => {
    const pg = { query: jest.fn() };

    const badCursor = await invoke(pg, "get", "/:address", {
      params: { address: RECIPIENT },
      query: { cursor: "not-a-cursor" },
    });
    const badAddress = await invoke(pg, "get", "/:address", { params: { address: "nope" } });
    const badLimit = await invoke(pg, "get", "/:address", {
      params: { address: RECIPIENT },
      query: { limit: "500" },
    });

    expect(badCursor.status).toHaveBeenCalledWith(400);
    expect(badAddress.status).toHaveBeenCalledWith(400);
    expect(badLimit.status).toHaveBeenCalledWith(400);
    expect(pg.query).not.toHaveBeenCalled();
  });

  it("reports database failures as 500", async () => {
    const pg = { query: jest.fn().mockRejectedValue(new Error("down")) };
    const res = await invoke(pg, "get", "/:address", { params: { address: RECIPIENT } });
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("derives inbox rows that exclude self-actions and deleted posts", () => {
    expect(INBOX_QUERY).toContain("f.follower <> $1");
    expect(INBOX_QUERY).toContain("l.user_address <> $1");
    expect(INBOX_QUERY).toContain("t.tipper <> $1");
    expect(INBOX_QUERY.match(/p\.deleted_at IS NULL/g)).toHaveLength(2);
    expect(INBOX_QUERY).toContain("(i.created_at, i.id) < ($2::timestamptz, $3::text)");
    expect(INBOX_QUERY).toContain("ORDER BY i.created_at DESC, i.id DESC");
  });
});

describe("POST /api/notifications/inbox/read-all", () => {
  it("moves the caller's watermark forward and returns it", async () => {
    const readThrough = new Date("2026-05-03T00:00:00Z");
    const pg = { query: jest.fn().mockResolvedValue({ rows: [{ read_through: readThrough }] }) };

    const res = await invoke(pg, "post", "/read-all", { headers: { "x-test-address": RECIPIENT } });

    expect(pg.query.mock.calls[0][0]).toContain("INSERT INTO notification_read_state");
    expect(pg.query.mock.calls[0][0]).toContain("GREATEST");
    expect(pg.query.mock.calls[0][1]).toEqual([RECIPIENT]);
    expect(pg.query).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ read_through: readThrough });
  });

  it("requires an authenticated caller", async () => {
    const pg = { query: jest.fn() };
    const res = await invoke(pg, "post", "/read-all", {});
    expect(res.status).toHaveBeenCalledWith(401);
    expect(pg.query).not.toHaveBeenCalled();
  });
});
