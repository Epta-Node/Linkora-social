import { MemoryPostStore } from "../../db/MemoryPostStore";
import { PostRepository } from "../../db/PostRepository";
import type { PostRecord } from "../../db/types";
import { createOptimisticPost, reconcilePendingPosts, retryPendingPost } from "../optimisticPost";

const AUTHOR = "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function newRepo(): PostRepository {
  return new PostRepository(new MemoryPostStore());
}

describe("createOptimisticPost", () => {
  it("shows the post immediately as pending, then confirms it after submit", async () => {
    const repo = newRepo();
    const submit = jest.fn(async () => "chain-1");

    const { localId, settled } = await createOptimisticPost(repo, submit, AUTHOR, "gm");

    // Immediately visible as pending.
    const pendingNow = await repo.getPending();
    expect(pendingNow).toHaveLength(1);
    expect(pendingNow[0].local_id).toBe(localId);

    await settled;

    // Promoted to a confirmed post, removed from pending.
    expect(await repo.getPending()).toHaveLength(0);
    const page = await repo.getPage(0, 10);
    expect(page).toHaveLength(1);
    expect(page[0].id).toBe("chain-1");
    expect(page[0].content).toBe("gm");
    expect(submit).toHaveBeenCalledWith("gm");
  });

  it("marks the post failed when submit rejects", async () => {
    const repo = newRepo();
    const submit = jest.fn(async () => {
      throw new Error("tx rejected");
    });

    const { settled } = await createOptimisticPost(repo, submit, AUTHOR, "gm");
    await settled;

    const [pending] = await repo.getPending();
    expect(pending.status).toBe("failed");
    expect(pending.error).toBe("tx rejected");
    expect(await repo.getPage(0, 10)).toHaveLength(0);
  });
});

describe("retryPendingPost", () => {
  it("re-submits a failed post and confirms it on success", async () => {
    const repo = newRepo();
    const submit = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("chain-9");

    const { localId, settled } = await createOptimisticPost(repo, submit, AUTHOR, "retry me");
    await settled;
    expect((await repo.getPending())[0].status).toBe("failed");

    await retryPendingPost(repo, submit, AUTHOR, localId);

    expect(await repo.getPending()).toHaveLength(0);
    expect((await repo.getPage(0, 10))[0].id).toBe("chain-9");
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

describe("reconcilePendingPosts", () => {
  it("reconciles a pending post that the indexer already shows, without resubmitting", async () => {
    const repo = newRepo();
    const pending = await repo.addPending("local-1", "duplicate");
    const confirmed: PostRecord = {
      id: "chain-1",
      author: AUTHOR,
      content: "duplicate",
      tip_total: "0",
      like_count: 0,
      timestamp: pending.created_at,
      synced_at: pending.created_at,
    };
    await repo.upsert([confirmed]);

    const reconciled = await reconcilePendingPosts(repo, AUTHOR);

    expect(reconciled).toEqual(["local-1"]);
    expect(await repo.getPending()).toHaveLength(0);
  });

  it("leaves unmatched pending posts untouched", async () => {
    const repo = newRepo();
    await repo.addPending("local-1", "never confirmed");

    const reconciled = await reconcilePendingPosts(repo, AUTHOR);

    expect(reconciled).toEqual([]);
    expect(await repo.getPending()).toHaveLength(1);
  });
});
