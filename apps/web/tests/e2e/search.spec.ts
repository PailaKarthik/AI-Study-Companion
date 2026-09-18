import { test, expect } from "@playwright/test";

/**
 * Retrieval test interface against the real backend (no API mocking).
 * Requires the backend (see spaces-projects.spec.ts header).
 * Skips without E2E_WITH_BACKEND=1.
 *
 * This spec verifies the honest paths on an unindexed project: the
 * panel renders in the materials tab, validation rejects empty
 * queries, and searches return the empty state — never fabricated
 * results. The full Upload → Ready → Searchable flow (with-results
 * behavior) is covered by document-processing.spec.ts, which runs the
 * worker; with-results API behavior is covered by
 * apps/api/src/search.test.ts.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

test.describe("project search panel", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("search validates, loads empty, and survives refresh", async ({ page }) => {
    const email = `e2e-search-${stamp}@example.com`;
    const spaceName = `Search Space ${stamp}`;
    const projectName = `Search Project ${stamp}`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Search");
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
    // Generous timeout: dialog mutations navigate after the round trip,
    // and dev servers can stall route commits under load.
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/, { timeout: 30000 });
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: /^create project$/i }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/spaces\/[^/]+\/projects\/[^/]+$/, { timeout: 30000 });

    // Materials tab hosts the retrieval test panel.
    await page.getByRole("tab", { name: /materials/i }).click();
    await expect(page).toHaveURL(/tab=materials/);
    await expect(page.getByRole("textbox", { name: /search project materials/i })).toBeVisible();

    // Empty submit is rejected client-side with no network traffic.
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByText("Type a question or keyword")).toBeVisible();

    // Real search against an unindexed project: honest empty state.
    await page.getByRole("textbox", { name: /search project materials/i }).fill("photosynthesis");
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByText("No relevant evidence found")).toBeVisible({ timeout: 30000 });

    // Refresh keeps working; the panel is stateless.
    await page.reload();
    await expect(page.getByRole("textbox", { name: /search project materials/i })).toBeVisible();
  });
});
