import { test, expect } from "@playwright/test";

/**
 * Full Spaces → Projects flow against the real backend (no API mocking):
 *
 *   1. API on http://localhost:4000 with a migrated database
 *      (see docs/DEVELOPMENT.md — `pnpm db:migrate`)
 *   2. Web pointed at it (default NEXT_PUBLIC_API_URL)
 *   3. E2E_WITH_BACKEND=1 pnpm --filter @ai-study-companion/web test:e2e
 *
 * Without the backend these specs skip. Registration needs no seed data;
 * unique names per run keep reruns independent.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

test.describe("spaces and projects flow", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("register → home → create space → open space → create project → refresh persists → tabs → logout", async ({
    page,
  }) => {
    const email = `e2e-flow-${stamp}@example.com`;
    const spaceName = `E2E Space ${stamp}`;
    const projectName = `E2E Project ${stamp}`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Flow");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("e2e-password-123");
    await page.getByRole("button", { name: /^register$/i }).click();

    // Home shows the honest empty state (fresh account, real API data).
    // Generous timeout: dev servers compile the route on first hit.
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByText("Nothing in progress yet")).toBeVisible();

    // Create a space from the dialog.
    await page
      .getByRole("link", { name: /spaces/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/spaces$/);
    await page.getByRole("button", { name: /new space/i }).click();
    await page.getByLabel("Name").fill(spaceName);
    await page.getByLabel(/description/i).fill("Created by the Playwright flow");
    // noWaitAfter: the dialog unmounts on success and can detach the
    // button mid-click; the URL/heading assertions below are the real check.
    await page.getByRole("button", { name: /^create space$/i }).click({ noWaitAfter: true });

    // Lands on the new space; card-free detail with real name.
    await expect(page).toHaveURL(/\/spaces\/[^/]+$/);
    await expect(page.getByRole("heading", { name: spaceName })).toBeVisible();

    // Create a project from the dialog.
    await page.getByRole("button", { name: /new project/i }).click();
    await page.getByLabel("Project name").fill(projectName);
    await page.getByLabel("Learning goal", { exact: false }).first().fill("Survive the E2E flow");
    await page.getByRole("button", { name: /^create project$/i }).click({ noWaitAfter: true });

    // Project dashboard with real header + overview content.
    await expect(page).toHaveURL(/\/spaces\/[^/]+\/projects\/[^/]+$/);
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    await expect(
      page.getByRole("tabpanel", { name: "Overview" }).getByText("Survive the E2E flow")
    ).toBeVisible();

    // Refresh preserves everything (persisted in PostgreSQL, tab in URL).
    await page.getByRole("tab", { name: /materials/i }).click();
    await expect(page).toHaveURL(/tab=materials/);
    await page.reload();
    await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
    await expect(page.getByRole("tab", { name: /materials/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByText("No learning materials yet")).toBeVisible();
    await expect(page.getByRole("button", { name: /upload pdf/i })).toBeVisible();

    // Back home: the dashboard now reflects real state.
    await page.getByRole("link", { name: /^home$/i }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30000 });
    await expect(page.getByText(projectName).first()).toBeVisible();

    // Edit the project, verify persistence across reload.
    await page.getByText(projectName).first().click();
    await page.getByRole("button", { name: /^edit$/i }).click();
    await page.getByLabel("Project name").fill(`${projectName} v2`);
    await page.getByRole("button", { name: /^save changes$/i }).click({ noWaitAfter: true });
    await expect(page.getByRole("heading", { name: `${projectName} v2` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: `${projectName} v2` })).toBeVisible();

    // Logout ends the session.
    await page.getByRole("button", { name: new RegExp(`account menu for ${email}`, "i") }).click();
    await page.getByRole("menuitem", { name: /log out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
