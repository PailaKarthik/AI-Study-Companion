import { test, expect } from "@playwright/test";

/**
 * Backend-independent UI specs. These never touch the Express API:
 * redirects are client-side (TanStack /me → 401 → null → replace) and
 * failed submissions surface the error alert whether the API is down
 * (network error) or up (401 envelope).
 */

test("anonymous users meet the welcome experience at / (no login redirect)", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: /learn anything/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /get started/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^log in$/i }).first()).toBeVisible();
});

test("anonymous users are redirected from /spaces to /login", async ({ page }) => {
  await page.goto("/spaces");
  await expect(page).toHaveURL(/\/login$/);
});

test("login page renders the form with labels", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /register/i })).toBeVisible();
});

test("login shows client-side validation errors on empty submit", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^log in$/i }).click();
  await expect(page.locator("form").getByRole("alert").first()).toBeVisible();
});

test("register page renders name, email and password fields", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^register$/i })).toBeVisible();
});

test("failed login surfaces an error alert, not a blank screen", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("definitely-wrong-password-1");
  await page.getByRole("button", { name: /^log in$/i }).click();
  // Scoped to the form: Next.js renders its own route-announcer with role=alert.
  await expect(page.locator("form").getByRole("alert")).toContainText(/request failed/i);
});
