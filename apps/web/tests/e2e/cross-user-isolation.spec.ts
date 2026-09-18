import { test, expect, type Page } from "@playwright/test";

/**
 * Cross-user isolation through every reachable surface: direct API calls
 * are covered by apps/api/src/{spaces,projects,home}.test.ts; here the
 * second user's session must never render the first user's content —
 * via navigation, hand-edited URLs, or query parameters.
 *
 * Requires the backend (see spaces-projects.spec.ts header).
 * Skips without E2E_WITH_BACKEND=1.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

async function register(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Isolation");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("isolation-pass-123");
  await page.getByRole("button", { name: /^register$/i }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function logout(page: Page, email: string) {
  await page.getByRole("button", { name: new RegExp(`account menu for ${email}`, "i") }).click();
  await page.getByRole("menuitem", { name: /log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe("cross-user isolation", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("user B cannot see or open user A's space and project", async ({ page }) => {
    const emailA = `e2e-iso-a-${stamp}@example.com`;
    const emailB = `e2e-iso-b-${stamp}@example.com`;
    const spaceName = `Iso Space ${stamp}`;
    const projectName = `Iso Project ${stamp}`;

    // User A creates a space + project and captures their URLs.
    await register(page, emailA);
    await page
      .getByRole("link", { name: /spaces/i })
      .first()
      .click();
    await page.getByRole("button", { name: /new space/i }).click();
    await page.getByLabel("Name").fill(spaceName);
    await page.getByRole("button", { name: /^create space$/i }).click();
    // URL first: the new card also renders an h3 on the list page, so the
    // heading alone cannot prove navigation completed. Generous timeouts:
    // dialog mutations navigate after the round trip.
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: spaceName })).toBeVisible();
    const spaceUrl = page.url();
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByRole("button", { name: /^create project$/i }).click();
    await expect(page).toHaveURL(/\/spaces\/[^/]+\/projects\/[^/]+$/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    const projectUrl = page.url();
    await logout(page, emailA);

    // User B: home, spaces list, and search show none of A's content.
    await register(page, emailB);
    await expect(page.getByText("Nothing in progress yet")).toBeVisible();
    await page
      .getByRole("link", { name: /spaces/i })
      .first()
      .click();
    await expect(page.getByText("No learning spaces yet")).toBeVisible();
    await page.getByLabel(/search spaces/i).fill(spaceName);
    // Fail fast with a clear signal if the fill itself doesn't stick.
    await expect(page.getByLabel(/search spaces/i)).toHaveValue(spaceName);
    await expect(page.getByText("No spaces match your search")).toBeVisible({ timeout: 15000 });

    // Hand-edited URLs to A's ids render the not-found experience.
    await page.goto(spaceUrl);
    await expect(page.getByText("Not found")).toBeVisible();
    await page.goto(projectUrl);
    await expect(page.getByText("Not found")).toBeVisible();
    // Query parameters don't leak anything either (search is local UI
    // state; unknown params are ignored and B still sees nothing of A).
    await page.goto(`/spaces?q=${encodeURIComponent(spaceName)}`);
    await expect(page.getByText("No learning spaces yet")).toBeVisible({ timeout: 15000 });
  });
});
