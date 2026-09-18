import { test, expect } from "@playwright/test";

/**
 * Quiz tab against the real backend (no API mocking).
 * Requires the backend (see spaces-projects.spec.ts header).
 * Skips without E2E_WITH_BACKEND=1.
 *
 * Without indexed project knowledge, generation is honestly refused, so
 * this spec verifies the real UI contract around that: the tab renders,
 * the creation form validates client-side, and the server's refusal
 * surfaces as an actionable error — never fabricated questions.
 * Full generation/attempt/completion flows are covered by
 * apps/api/src/quiz.test.ts with a routed LLM stub.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);

test.describe("project quiz tab", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + database running");

  test("quiz validates, refuses empty knowledge honestly, and survives refresh", async ({
    page,
  }) => {
    const email = `e2e-quiz-${stamp}@example.com`;
    const spaceName = `Quiz Space ${stamp}`;
    const projectName = `Quiz Project ${stamp}`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Quiz");
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

    // Quiz tab hosts the real assessment UI (no mock questions anywhere).
    await page.getByRole("tab", { name: /quiz/i }).click();
    await expect(page).toHaveURL(/tab=quiz/);
    await expect(page.getByText("No quizzes yet")).toBeVisible();

    // Creation form validates the count client-side.
    await page.getByRole("button", { name: /new quiz/i }).click();
    await page.getByLabel("Number of questions").fill("0");
    await page.getByRole("button", { name: /generate quiz/i }).click();
    await expect(page.getByText(/greater than or equal to 1|expected number/i)).toBeVisible();

    // Honest server refusal: no indexed materials, no fabricated quiz.
    await page.getByLabel("Number of questions").fill("3");
    await page.getByRole("button", { name: /generate quiz/i }).click();
    await expect(page.getByText(/no indexed materials/i)).toBeVisible({ timeout: 60000 });

    // Refresh keeps the tab working; quiz state is server-side.
    await page.reload();
    await page.getByRole("tab", { name: /quiz/i }).click();
    await expect(page.getByText("No quizzes yet")).toBeVisible();
  });
});
