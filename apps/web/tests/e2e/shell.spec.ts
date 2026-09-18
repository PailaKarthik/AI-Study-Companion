import { test, expect } from "@playwright/test";

/**
 * Authenticated shell flow. Requires a running backend:
 *
 *   1. API on http://localhost:4000 with a migrated database
 *      (see docs/DEVELOPMENT.md — `pnpm db:migrate`)
 *   2. Web pointed at it (default NEXT_PUBLIC_API_URL)
 *   3. E2E_WITH_BACKEND=1 pnpm --filter @ai-study-companion/web test:e2e
 *
 * Without the backend these specs skip — the auth-ui spec covers the
 * backend-independent paths instead. Registration needs no seed data.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;

test.describe("authenticated shell", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("register → dashboard shell with sidebar → logout → login", async ({ page }) => {
    const email = `e2e-${Date.now()}@example.com`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Tester");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /^register$/i }).click();

    // Dashboard shell loads behind the session cookie.
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /spaces/i }).first()).toBeVisible();
    await expect(page.getByText("Continue learning")).toBeVisible();

    // Sidebar navigation works.
    await page
      .getByRole("link", { name: /^spaces$/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/spaces$/);
    await expect(page.getByRole("heading", { name: /^spaces$/i })).toBeVisible();
    await expect(page.getByText("No learning spaces yet")).toBeVisible();

    // Project dashboard tabs are URL-driven. Unknown ids correctly render
    // an error state instead of fake tabs (verified below with real data).
    await page.goto(
      "/spaces/00000000-0000-4000-8000-000000000000/projects/00000000-0000-4000-8000-000000000000"
    );
    await expect(page.getByText("This doesn't exist or you don't have access to it")).toBeVisible();

    // Same tab behavior against a real project created through the UI.
    await page
      .getByRole("link", { name: /spaces/i })
      .first()
      .click();
    await page.getByRole("button", { name: /new space/i }).click();
    await page.getByLabel("Name").fill(`Shell Space ${Date.now().toString(36)}`);
    await page.getByRole("button", { name: /^create space$/i }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/);
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel("Project name").fill(`Shell Project ${Date.now().toString(36)}`);
    await page.getByRole("button", { name: /^create project$/i }).click({ noWaitAfter: true });
    await expect(page).toHaveURL(/\/spaces\/[^/]+\/projects\/[^/]+$/);
    await page.getByRole("tab", { name: /quiz/i }).click();
    await expect(page).toHaveURL(/tab=quiz/);
    await expect(page.getByText("No quizzes yet")).toBeVisible();
    await page.getByRole("tab", { name: /tutor/i }).click();
    await expect(page).toHaveURL(/tab=tutor/);
    await expect(page.getByText("Ask your first question")).toBeVisible();
    // Refresh preserves the active tab.
    await page.reload();
    await expect(page.getByRole("tab", { name: /tutor/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Logout revokes the server session and returns to login.
    await page.getByRole("button", { name: new RegExp(`account menu for ${email}`, "i") }).click();
    await page.getByRole("menuitem", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Session is gone: home bounces back to login.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});
