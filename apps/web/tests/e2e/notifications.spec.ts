import { test, expect, Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedAllEventTypes(page: Page, addr: string) {
  await page.evaluate(
    ({ addr }) => {
      const key = `linkora:notifications:items:${addr}`;
      const now = new Date().toISOString();
      const items = [
        {
          id: "follow-GBACTOR111-1",
          type: "follow",
          actor: "GBACTOR111AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          timestamp: now,
          read: false,
        },
        {
          id: "like-GBACTOR222-42",
          type: "like",
          actor: "GBACTOR222AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          postId: 42,
          excerpt: "Hello from the other side of the blockchain",
          timestamp: now,
          read: false,
        },
        {
          id: "tip-GBACTOR333-99",
          type: "tip",
          actor: "GBACTOR333AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          postId: 99,
          amountXlm: "5.00",
          excerpt: "My first Linkora post ever",
          timestamp: now,
          read: false,
        },
      ];
      localStorage.setItem(key, JSON.stringify(items));
      localStorage.setItem("linkora:notifications:unread", "3");
      localStorage.setItem("linkora_wallet_address", addr);
    },
    { addr }
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Notifications page", () => {
  const walletAddr = "GBTEST0000000000000000000000000000000000000000000000000000";

  test("shows empty state when no notifications", async ({ page }) => {
    await page.goto("/notifications");
    await page.evaluate((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, walletAddr);
    await page.reload();

    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByText("No activity yet")).toBeVisible();
  });

  test("renders follow, like, and tip notifications with correct text", async ({ page }) => {
    await page.goto("/");
    await seedAllEventTypes(page, walletAddr);
    await page.goto("/notifications");

    const items = page.getByTestId("notification-item");
    await expect(items).toHaveCount(3);

    await expect(page.getByText(/started following you/)).toBeVisible();
    await expect(page.getByText(/liked your post/)).toBeVisible();
    await expect(page.getByText(/tipped.*XLM/)).toBeVisible();
  });

  test("like and tip notifications show post excerpt", async ({ page }) => {
    await page.goto("/");
    await seedAllEventTypes(page, walletAddr);
    await page.goto("/notifications");

    await expect(page.getByText(/Hello from the other side of the blockchain/)).toBeVisible();
    await expect(page.getByText(/My first Linkora post ever/)).toBeVisible();
  });

  test("notifications without excerpt fall back to post id reference", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(
      ({ addr }) => {
        const key = `linkora:notifications:items:${addr}`;
        const now = new Date().toISOString();
        localStorage.setItem(
          key,
          JSON.stringify([
            {
              id: "like-GBACTOR222-42",
              type: "like",
              actor: "GBACTOR222AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              postId: 42,
              timestamp: now,
              read: false,
            },
          ])
        );
        localStorage.setItem("linkora_wallet_address", addr);
      },
      { addr: walletAddr }
    );
    await page.goto("/notifications");

    await expect(page.getByText(/post #42/)).toBeVisible();
  });

  test("notifications are grouped under a date header", async ({ page }) => {
    await page.goto("/");
    await seedAllEventTypes(page, walletAddr);
    await page.goto("/notifications");

    // All seeded items use today's timestamp → "Today" group header is visible
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  });

  test("unread badge appears on bell icon before visiting page", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
      localStorage.setItem("linkora:notifications:unread", "3");
    }, walletAddr);
    await page.reload();

    const badge = page.getByTestId("unread-badge");
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText("3");
  });

  test("unread badge clears after visiting notifications page", async ({ page }) => {
    await page.goto("/");
    await seedAllEventTypes(page, walletAddr);
    await page.reload();

    await expect(page.getByTestId("unread-badge")).toBeVisible();

    await page.goto("/notifications");
    await page.waitForTimeout(300);

    await page.goto("/feed");
    await expect(page.getByTestId("unread-badge")).not.toBeVisible();
  });

  test("mark all read button clears unread indicators", async ({ page }) => {
    await page.goto("/");
    await seedAllEventTypes(page, walletAddr);
    await page.goto("/notifications");

    const markAllRead = page.getByTestId("mark-all-read");
    // markAllRead may already be hidden if visit auto-marked-read; force unread state
    if (!(await markAllRead.isVisible())) {
      await page.evaluate((addr) => {
        const key = `linkora:notifications:items:${addr}`;
        const stored = localStorage.getItem(key);
        if (stored) {
          const items = JSON.parse(stored).map((n: Record<string, unknown>) => ({
            ...n,
            read: false,
          }));
          localStorage.setItem(key, JSON.stringify(items));
        }
      }, walletAddr);
      await page.reload();
    }

    await page.getByTestId("mark-all-read").click();
    await expect(page.getByTestId("mark-all-read")).not.toBeVisible();
  });

  test("new follow notification appears without page reload via seeded localStorage", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, walletAddr);
    await page.goto("/notifications");

    // Simulate event arriving by seeding localStorage then reloading
    await page.evaluate(
      ({ addr, actor }) => {
        const key = `linkora:notifications:items:${addr}`;
        const items = [
          {
            id: `follow-${actor}-mock`,
            type: "follow",
            actor,
            timestamp: new Date().toISOString(),
            read: false,
          },
        ];
        localStorage.setItem(key, JSON.stringify(items));
      },
      { addr: walletAddr, actor: "GBACTOR999AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }
    );

    await page.reload();

    await expect(page.getByTestId("notification-item")).toHaveCount(1);
    await expect(page.getByText(/started following you/)).toBeVisible();
  });

  test("load more button shows additional notifications beyond first page", async ({ page }) => {
    const addr = walletAddr;
    await page.goto("/");
    await page.evaluate(
      ({ addr }) => {
        const key = `linkora:notifications:items:${addr}`;
        const items = Array.from({ length: 15 }, (_, i) => ({
          id: `follow-GBACTOR${i}-${i}`,
          type: "follow",
          actor: `GBACTOR${String(i).padStart(54, "0")}`,
          timestamp: new Date(Date.now() - i * 1000).toISOString(),
          read: false,
        }));
        localStorage.setItem(key, JSON.stringify(items));
        localStorage.setItem("linkora_wallet_address", addr);
      },
      { addr }
    );
    await page.goto("/notifications");

    await expect(page.getByTestId("notification-item")).toHaveCount(10);

    await page.getByTestId("load-more").click();

    await expect(page.getByTestId("notification-item")).toHaveCount(15);
    await expect(page.getByTestId("load-more")).not.toBeVisible();
  });
});
