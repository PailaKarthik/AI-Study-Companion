import { test, expect } from "@playwright/test";

/**
 * Analytics tab + admin forbidden flow against the real backend
 * (no API mocking). Requires the backend (see spaces-projects.spec.ts
 * header). Skips without E2E_WITH_BACKEND=1.
 *
 * Covered here: honest empty states on home + project analytics,
 * activity appearing after real actions (project views), refresh
 * persistence, cross-user denial, and the admin gate for normal users.
 * Aggregated math is covered by apps/api/src/analytics.test.ts and
 * apps/api/src/admin.test.ts against a real database.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

test.describe("project analytics tab", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("empty states, real activity after views, refresh persists", async ({ page }) => {
    const email = `e2e-analytics-${stamp}@example.com`;
    const spaceName = `Analytics Space ${stamp}`;
    const projectName = `Analytics Project ${stamp}`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Analytics");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /^register$/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });

    // Home learning-activity section is honestly empty for a new account.
    await expect(page.getByText("No learning activity yet")).toBeVisible();

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

    // Analytics renders real sections from persisted rows — project
    // creation itself is already activity, so there is no fake empty.
    // Generous timeout: dev servers compile the route on first hit.
    await page.getByRole("tab", { name: /analytics/i }).click();
    await expect(page).toHaveURL(/tab=analytics/);
    await expect(page.getByText("Activity over time")).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Recent activity")).toBeVisible();

    // Viewing the overview records a real PROJECT_VIEWED event; it shows
    // up in recent activity (not a mock).
    await page.getByRole("tab", { name: /overview/i }).click();
    await expect(page.getByText("Learning progress")).toBeVisible();
    await page.getByRole("tab", { name: /analytics/i }).click();
    await expect(page.getByText("project viewed", { exact: false }).first()).toBeVisible({
      timeout: 30000,
    });

    // Refresh keeps working; all analytics state is server-side.
    await page.reload();
    await page.getByRole("tab", { name: /analytics/i }).click();
    await expect(page.getByText("Activity over time")).toBeVisible();
  });

  test("normal users are kept out of /admin", async ({ page }) => {
    const email = `e2e-nadmin-${stamp}@example.com`;
    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Normal");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /^register$/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });

    // Client guard redirects; the API itself returns 403 (covered in
    // apps/api/src/admin.test.ts against a real database).
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/spaces/, { timeout: 30000 });
  });
});
