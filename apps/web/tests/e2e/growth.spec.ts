import { test, expect } from "@playwright/test";

/**
 * Growth tab against the real backend (no API mocking).
 * Requires the backend (see spaces-projects.spec.ts header).
 * Skips without E2E_WITH_BACKEND=1.
 *
 * Without assessed evidence the board is honestly empty, so this spec
 * verifies the real UI contract around that: the tab renders, empty
 * states explain what builds a profile (never 0% as fake progress), and
 * refresh keeps working. Assessed-data flows are covered by
 * apps/api/src/mastery.test.ts against a real database.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

test.describe("project growth tab", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("growth shows honest empty states and survives refresh", async ({ page }) => {
    const email = `e2e-growth-${stamp}@example.com`;
    const spaceName = `Growth Space ${stamp}`;
    const projectName = `Growth Project ${stamp}`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Growth");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /^register$/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });

    await page
      .getByRole("link", { name: /spaces/i })
      .first()
      .click();
    await page.getByRole("button", { name: /new space/i }).click();
    await page.getByLabel("Name").fill(spaceName);
    await page.getByRole("button", { name: /^create space$/i }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/, { timeout: 30000 });
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: /^create project$/i }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/spaces\/[^/]+\/projects\/[^/]+$/, { timeout: 30000 });

    // Growth tab with no concepts: honest empty state, no fake numbers.
    await page.getByRole("tab", { name: /growth/i }).click();
    await expect(page).toHaveURL(/tab=growth/);
    await expect(page.getByText("No concepts yet")).toBeVisible();

    // Overview shows no fabricated progress either.
    await page.getByRole("tab", { name: /overview/i }).click();
    await expect(page.getByText("No progress yet")).toBeVisible();
    await expect(page.getByText("No recommendations yet")).toBeVisible();

    // Refresh keeps the tabs working; all growth state is server-side.
    await page.reload();
    await page.getByRole("tab", { name: /growth/i }).click();
    await expect(page.getByText("No concepts yet")).toBeVisible();
  });
});
