import { createUsersRouter } from "../users";
import { Database } from "../../../db";

const VALID_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res;
}

async function invokeRoute(
  router: ReturnType<typeof createUsersRouter>,
  path: string,
  req: Record<string, unknown>
) {
  const layer = router.stack.find((item: any) => item.route?.path === path);
  if (!layer) throw new Error(`Route ${path} not found`);

  const res = createMockResponse();
  const stack = layer.route.stack;

  let i = 0;
  const next = () => {
    if (i < stack.length) {
      const handler = stack[i++].handle;
      handler(req, res, next);
    }
  };
  next();
  return res;
}

async function getBlocked(address: string, query: Record<string, unknown>, db: Database) {
  const router = createUsersRouter(db);
  return invokeRoute(router, "/:address/blocked", { params: { address }, query });
}

async function getDmKey(address: string, db: Database) {
  const router = createUsersRouter(db);
  return invokeRoute(router, "/:address/dm-key", { params: { address } });
}

describe("users API", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = {
      getBlockedUsers: jest.fn().mockResolvedValue({
        blocked: ["GBLOCKED1", "GBLOCKED2"],
        total: 2,
      }),
      getDmKey: jest.fn().mockResolvedValue("x25519keyhexvalue"),
    } as unknown as jest.Mocked<Database>;
  });

  describe("GET /users/:address/blocked", () => {
    it("returns blocked users with default limit and offset", async () => {
      const res = await getBlocked(VALID_ADDRESS, {}, db);

      expect(db.getBlockedUsers).toHaveBeenCalledWith(VALID_ADDRESS, 20, 0);
      expect(res.json).toHaveBeenCalledWith({
        address: VALID_ADDRESS,
        blocked: ["GBLOCKED1", "GBLOCKED2"],
        total: 2,
        limit: 20,
        offset: 0,
        has_more: false,
      });
    });

    it("returns blocked users with custom limit and offset", async () => {
      const res = await getBlocked(VALID_ADDRESS, { limit: "5", offset: "10" }, db);

      expect(db.getBlockedUsers).toHaveBeenCalledWith(VALID_ADDRESS, 5, 10);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 5,
          offset: 10,
        })
      );
    });

    it("rejects invalid limit or offset", async () => {
      const res1 = await getBlocked(VALID_ADDRESS, { limit: "-1" }, db);
      expect(res1.status).toHaveBeenCalledWith(400);

      const res2 = await getBlocked(VALID_ADDRESS, { offset: "abc" }, db);
      expect(res2.status).toHaveBeenCalledWith(400);
    });

    it("rejects missing address", async () => {
      const res = await getBlocked("", {}, db);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GET /users/:address/dm-key", () => {
    it("returns DM key if found", async () => {
      const res = await getDmKey(VALID_ADDRESS, db);

      expect(db.getDmKey).toHaveBeenCalledWith(VALID_ADDRESS);
      expect(res.json).toHaveBeenCalledWith({
        address: VALID_ADDRESS,
        x25519_pubkey: "x25519keyhexvalue",
      });
    });

    it("returns 404 if not found", async () => {
      db.getDmKey.mockResolvedValueOnce(null);
      const res = await getDmKey(VALID_ADDRESS, db);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        error: {
          code: "NOT_FOUND",
          message: "DM key not found",
        },
      });
    });

    it("rejects missing address", async () => {
      const res = await getDmKey("", db);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
