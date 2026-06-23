import { test, expect } from '@playwright/test';
import { connectWallet } from './test-utils';

test.describe('Governance Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to governance page
    await page.goto('/governance');
  });

  test('should display active proposals and config details', async ({ page }) => {
    // Check page header
    await expect(page.getByRole('heading', { name: 'Governance' })).toBeVisible();
    await expect(page.getByText('Propose and vote on protocol parameters')).toBeVisible();

    // Verify mock proposal is displayed
    await expect(page.getByText('Proposal #2')).toBeVisible();
    await expect(page.getByText('TipCooldownWindow')).toBeVisible();
  });

  test('should enforce range validations on proposal creation', async ({ page }) => {
    // Connect wallet to see the form
    await connectWallet(page);

    // Try to propose an invalid FeeBps (> 10000)
    await page.selectOption('#param-select', 'FeeBps');
    await page.fill('#value-input', '15000');
    await page.click('button:has-text("Submit Proposal")');

    // Verify validation error
    await expect(page.getByText('Fee bps must be between 0 and 10000.')).toBeVisible();

    // Try to propose an invalid GovQuorum (> 100)
    await page.selectOption('#param-select', 'GovQuorum');
    await page.fill('#value-input', '150');
    await page.click('button:has-text("Submit Proposal")');

    // Verify validation error
    await expect(page.getByText('Quorum must be between 1 and 100.')).toBeVisible();

    // Try to propose negative cooldown
    await page.selectOption('#param-select', 'TipCooldownWindow');
    await page.fill('#value-input', '-10');
    await page.click('button:has-text("Submit Proposal")');

    // Verify validation error
    await expect(page.getByText('Cooldown and lock windows must be positive.')).toBeVisible();

    // Try to propose treasury without valid address
    await page.selectOption('#param-select', 'Treasury');
    await page.fill('#treasury-input', 'invalid-addr');
    await page.click('button:has-text("Submit Proposal")');

    // Verify validation error
    await expect(page.getByText('A valid Stellar treasury address is required.')).toBeVisible();
  });

  test('should vote "For" on active proposal and update count', async ({ page }) => {
    // Connect wallet
    await connectWallet(page);

    // Wait for proposals to load
    await expect(page.getByText('Proposal #2')).toBeVisible();

    // Find the proposal card container for Proposal #2
    const proposalCard = page.locator('article:has-text("Proposal #2")').first();
    
    // Get initial "For" votes text/count
    const initialForVotes = await proposalCard.locator('text=/👍 For:/').textContent();
    const initialCount = parseInt(initialForVotes?.replace(/[^0-9]/g, '') || '0');

    // Click "Vote For" button within the card
    const voteForBtn = proposalCard.locator('button:has-text("Vote For")').first();
    await voteForBtn.click();

    // Check loading overlay text
    await expect(page.getByText('Broadcasting transaction...')).toBeVisible();

    // Wait for transaction processing to finish (loading overlay disappears)
    await page.waitForTimeout(2000);

    // Verify vote count updated
    const updatedForVotes = await proposalCard.locator('text=/👍 For:/').textContent();
    const updatedCount = parseInt(updatedForVotes?.replace(/[^0-9]/g, '') || '0');

    expect(updatedCount).toBeGreaterThan(initialCount);
    // Button should be disabled now
    await expect(voteForBtn).toBeDisabled();
  });

  test('should submit new proposal successfully', async ({ page }) => {
    // Connect wallet
    await connectWallet(page);

    // Create a FeeBps proposal
    await page.selectOption('#param-select', 'FeeBps');
    await page.fill('#value-input', '2500');
    await page.click('button:has-text("Submit Proposal")');

    // Check loading overlay text
    await expect(page.getByText('Proposing parameter change in Freighter...')).toBeVisible();

    // Wait for transaction processing to finish
    await page.waitForTimeout(2000);

    // Verify proposal appears in active list (Proposal #5)
    await expect(page.getByText('Proposal #5')).toBeVisible();
    
    const newProposalCard = page.locator('article:has-text("Proposal #5")').first();
    await expect(newProposalCard.getByText('FeeBps')).toBeVisible();
    await expect(newProposalCard.getByText('2500')).toBeVisible();
  });
});

