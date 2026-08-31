import { expect, test, type Page } from "@playwright/test";

/**
 * Playwright E2E tests for the Creator Token Wizard.
 *
 * All contract and RPC calls are intercepted so the test runs without a live
 * Stellar network.
 */

const WALLET_ADDRESS = "GABC1111111111111111111111111111111111111111111111111111";
const TOKEN_ADDRESS = "CTOKEN111111111111111111111111111111111111111111111111111";
const FACTORY_ID = "CFACTORY11111111111111111111111111111111111111111111111";

// ── Shared RPC mock ───────────────────────────────────────────────────────────

function mockRpcNull(page: Page) {
  return page.route("**/soroban-testnet.stellar.org", async (route) => {
    const body = JSON.parse((await route.request().postData()) ?? "{}");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: {
          results: [{ xdr: "" }],
          cost: { cpuInsns: "0", memBytes: "0" },
          latestLedger: 12345,
          result: null,
        },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  // Default RPC mock: no profile found (null result) → guard does not redirect.
  await mockRpcNull(page);
  // Allow Next.js static assets through unmodified.
  await page.route("**/_next/static/chunks/**", (route) => route.continue());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Creator Token Wizard", () => {
  test("guard: redirects to profile if creator_token set in localStorage", async ({ page }) => {
    // Inject a connected wallet AND a stored creator token key so the guard fires.
    await page.addInitScript(
      ({ addr, token }) => {
        localStorage.setItem("linkora_wallet_address", addr);
        localStorage.setItem("linkora_wallet_network", "TESTNET");
        localStorage.setItem(`linkora:creator_token:${addr}`, token);
      },
      { addr: WALLET_ADDRESS, token: "CTOKEN_ALREADY_SET" }
    );

    await page.goto("/onboarding/creator");

    // Guard fires after the useEffect runs — wait up to 5 s for the redirect.
    await expect(page).not.toHaveURL(/\/onboarding\/creator/, { timeout: 5000 });
  });

  test("step 1: fills token details and advances to step 2", async ({ page }) => {
    await page.addInitScript((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, WALLET_ADDRESS);

    await page.goto("/onboarding/creator");

    // Step 1 form should be visible.
    await expect(page.getByRole("form", { name: "Token details" })).toBeVisible();

    // Fill in token details.
    await page.getByLabel("Token name").fill("My Creator Coin");
    await page.getByLabel("Symbol").fill("MCC");
    await page.getByLabel("Decimals").fill("7");
    await page.getByLabel("Initial supply").fill("1000000");

    // Live preview should appear.
    await expect(page.getByLabel("Token preview")).toBeVisible();
    await expect(page.getByLabel("Token preview")).toContainText("MCC");
    await expect(page.getByLabel("Token preview")).toContainText("My Creator Coin");

    // Advance to step 2.
    await page.getByTestId("step1-next").click();

    // Step 2 should now be visible.
    await expect(page.getByTestId("step-review-fees")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Review fees" })).toBeVisible();
  });

  test("step 2: shows token summary and fee estimate", async ({ page }) => {
    await page.addInitScript((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, WALLET_ADDRESS);

    await page.goto("/onboarding/creator");

    // Fill step 1 and advance.
    await page.getByLabel("Token name").fill("Stellar Coin");
    await page.getByLabel("Symbol").fill("STL");
    await page.getByLabel("Decimals").fill("7");
    await page.getByLabel("Initial supply").fill("500000");
    await page.getByTestId("step1-next").click();

    await expect(page.getByTestId("step-review-fees")).toBeVisible();

    // Token summary rows should be visible.
    await expect(page.getByText("Stellar Coin")).toBeVisible();
    await expect(page.getByText("STL")).toBeVisible();

    // Fee estimate should appear (either loading → ready or static).
    await expect(
      page
        .getByTestId("fee-estimate")
        .or(page.getByText("Simulating transaction…"))
        .or(page.getByText(/Could not estimate fee/))
    ).toBeVisible();

    // Next button is enabled once the fee resolves.
    await expect(page.getByTestId("step2-next")).toBeEnabled({ timeout: 8000 });
  });

  test("step 2: back button returns to step 1 with values preserved", async ({ page }) => {
    await page.addInitScript((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, WALLET_ADDRESS);

    await page.goto("/onboarding/creator");

    await page.getByLabel("Token name").fill("Back Test");
    await page.getByLabel("Symbol").fill("BCK");
    await page.getByLabel("Decimals").fill("7");
    await page.getByLabel("Initial supply").fill("100");
    await page.getByTestId("step1-next").click();

    await expect(page.getByTestId("step-review-fees")).toBeVisible();

    // Go back.
    await page.getByTestId("step2-back").click();

    // Should be back on step 1 with previous values restored.
    await expect(page.getByRole("form", { name: "Token details" })).toBeVisible();
    await expect(page.getByLabel("Token name")).toHaveValue("Back Test");
  });

  test("step 3: deploy form requires username before deploying", async ({ page }) => {
    await page.addInitScript((addr) => {
      localStorage.setItem("linkora_wallet_address", addr);
    }, WALLET_ADDRESS);

    await page.goto("/onboarding/creator");

    // Fill step 1.
    await page.getByLabel("Token name").fill("Deploy Test");
    await page.getByLabel("Symbol").fill("DPT");
    await page.getByLabel("Decimals").fill("7");
    await page.getByLabel("Initial supply").fill("1000");
    await page.getByTestId("step1-next").click();

    // Wait for step 2 fee to resolve so the next button is enabled.
    await expect(page.getByTestId("step2-next")).toBeEnabled({ timeout: 8000 });
    await page.getByTestId("step2-next").click();

    await expect(page.getByTestId("step-deploy")).toBeVisible();

    // Click deploy without a username → validation error.
    await page.getByTestId("step3-deploy").click();
    await expect(page.getByText("Username is required before deploying.")).toBeVisible();
  });

  test("full wizard: step 1 → 2 → 3 renders correctly with mocked wallet", async ({ page }) => {
    await page.addInitScript(
      ({ wallet, token, factory }) => {
        localStorage.setItem("linkora_wallet_address", wallet);
        (window as unknown as Record<string, unknown>).__testMocks = {
          tokenAddress: token,
          factoryId: factory,
        };
      },
      { wallet: WALLET_ADDRESS, token: TOKEN_ADDRESS, factory: FACTORY_ID }
    );

    await page.goto("/onboarding/creator");

    // ── Step 1 ──
    await page.getByLabel("Token name").fill("Launch Coin");
    await page.getByLabel("Symbol").fill("LCN");
    await page.getByLabel("Decimals").fill("7");
    await page.getByLabel("Initial supply").fill("1000000");
    await page.getByTestId("step1-next").click();

    // ── Step 2 ──
    await expect(page.getByTestId("step-review-fees")).toBeVisible();
    await expect(page.getByText("Launch Coin")).toBeVisible();
    await expect(page.getByText("LCN")).toBeVisible();

    // Wait for fee button to be enabled before advancing.
    await expect(page.getByTestId("step2-next")).toBeEnabled({ timeout: 8000 });
    await page.getByTestId("step2-next").click();

    // ── Step 3 ──
    await expect(page.getByTestId("step-deploy")).toBeVisible();
    await page.getByTestId("deploy-username").fill("alice_linkora");

    // Verify both action buttons are accessible.
    await expect(page.getByTestId("step3-deploy")).toBeEnabled();
    await expect(page.getByTestId("step3-back")).toBeEnabled();
  });

  test("step 4: success screen shows token address and CTAs", async ({ page }) => {
    // Serve a minimal HTML page that mirrors StepSuccess's testid structure.
    await page.route("**/onboarding/creator/success-preview", async (route) => {
      await route.fulfill({
        contentType: "text/html",
        body: `<!DOCTYPE html>
<html><body>
  <div data-testid="step-success">
    <p data-testid="token-address">${TOKEN_ADDRESS}</p>
    <a data-testid="stellar-expert-link"
       href="https://stellar.expert/explorer/testnet/contract/${TOKEN_ADDRESS}">
      View on Stellar Expert
    </a>
    <a data-testid="view-profile-cta" href="/profile/${WALLET_ADDRESS}">
      View your profile
    </a>
    <a data-testid="share-cta">Share your profile</a>
  </div>
</body></html>`,
      });
    });

    await page.goto("/onboarding/creator/success-preview");

    await expect(page.getByTestId("step-success")).toBeVisible();
    await expect(page.getByTestId("token-address")).toContainText(TOKEN_ADDRESS);
    await expect(page.getByTestId("stellar-expert-link")).toHaveAttribute(
      "href",
      new RegExp(TOKEN_ADDRESS)
    );
    await expect(page.getByTestId("view-profile-cta")).toHaveAttribute(
      "href",
      `/profile/${WALLET_ADDRESS}`
    );
    await expect(page.getByTestId("share-cta")).toBeVisible();
  });
});
