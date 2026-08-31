import { createFollowsRouter } from "../follows";
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
  router: ReturnType<typeof createFollowsRouter>,
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

async function getFollowers(address: string, query: Record<string, unknown>, db: Database) {
  const router = createFollowsRouter(db);
  return invokeRoute(router, "/:address/followers", { params: { address }, query });
}

async function getFollowing(address: string, query: Record<string, unknown>, db: Database) {
  const router = createFollowsRouter(db);
  return invokeRoute(router, "/:address/following", { params: { address }, query });
}

describe("follows API", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = {
      getFollowers: jest.fn().mockResolvedValue({
        followers: ["GFOLLOWER1", "GFOLLOWER2"],
        total: 2,
      }),
      getFollowing: jest.fn().mockResolvedValue({
        following: ["GFOLLOWING1"],
        total: 1,
      }),
    } as unknown as jest.Mocked<Database>;
  });

  describe("GET /follows/:address/followers", () => {
    it("passes positional (address, limit, offset) to the database — never an object", async () => {
      const res = await getFollowers(VALID_ADDRESS, { cursor: "5" }, db);

      expect(db.getFollowers).toHaveBeenCalledWith(VALID_ADDRESS, 20, 5);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ address: VALID_ADDRESS, limit: 20 })
      );
    });

    it("rejects an object-shaped cursor (e.g. ?cursor[a]=b) with 400, not 500", async () => {
      const res = await getFollowers(VALID_ADDRESS, { cursor: { a: "b" } }, db);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.getFollowers).not.toHaveBeenCalled();
    });

    it("rejects an object-shaped limit with 400, not 500", async () => {
      const res = await getFollowers(VALID_ADDRESS, { limit: { a: "b" } }, db);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.getFollowers).not.toHaveBeenCalled();
    });

    it("rejects a non-numeric cursor with 400", async () => {
      const res = await getFollowers(VALID_ADDRESS, { cursor: "not-a-number" }, db);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.getFollowers).not.toHaveBeenCalled();
    });

    it("rejects an object-shaped address param with 400, not 500", async () => {
      const res = await getFollowers({ a: "b" } as unknown as string, {}, db);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.getFollowers).not.toHaveBeenCalled();
    });

    it("rejects a missing address with 400", async () => {
      const res = await getFollowers("", {}, db);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  describe("GET /follows/:address/following", () => {
    it("passes positional (address, limit, offset) to the database — never an object", async () => {
      const res = await getFollowing(VALID_ADDRESS, { limit: "5", cursor: "10" }, db);

      expect(db.getFollowing).toHaveBeenCalledWith(VALID_ADDRESS, 5, 10);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ address: VALID_ADDRESS, limit: 5 })
      );
    });

    it("rejects an object-shaped cursor with 400, not 500", async () => {
      const res = await getFollowing(VALID_ADDRESS, { cursor: { a: "b" } }, db);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(db.getFollowing).not.toHaveBeenCalled();
    });

    it("rejects a missing address with 400", async () => {
      const res = await getFollowing("", {}, db);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
