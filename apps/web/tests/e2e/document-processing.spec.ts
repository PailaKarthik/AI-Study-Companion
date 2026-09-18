import { test, expect } from "@playwright/test";

/**
 * Full document pipeline against the real backend + worker + Redis.
 * Requires E2E_WITH_BACKEND=1 with the API (port 4000), a BullMQ Redis,
 * and the worker (NODE_ENV=test so knowledge embeds with the mock
 * provider) all running — plus the usual Playwright web server.
 *
 * Flow: Upload PDF → (worker) Processing → Ready → Searchable.
 * Skips without E2E_WITH_BACKEND=1.
 */

const withBackend = !!process.env.E2E_WITH_BACKEND;
const stamp = Date.now().toString(36);
const uniqueTerm = `xrayflux${stamp}`;

/** Minimal valid single-page text PDF (Helvetica, pdfjs-parseable). */
function buildPdfBuffer(lines: string[]): Buffer {
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  const push = (body: string): void => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  push("<< /Type /Catalog /Pages 2 0 R >>");
  push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  const content = lines
    .map((l, li) => `BT /F1 12 Tf 72 ${720 - li * 16} Td (${l}) Tj ET`)
    .join("\n");
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`
  );
  offsets.push(out.length);
  out += `4 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
  push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xrefAt = out.length;
  const total = offsets.length + 1;
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, "0")} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

test.describe("document processing pipeline", () => {
  test.skip(!withBackend, "needs E2E_WITH_BACKEND=1 with API + worker + Redis running");

  test("upload PDF → processing → ready → searchable", async ({ page }) => {
    const email = `e2e-docpipe-${stamp}@example.com`;
    const spaceName = `Docpipe Space ${stamp}`;
    const projectName = `Docpipe Project ${stamp}`;
    const filename = `docpipe-${stamp}.pdf`;

    await page.goto("/register");
    await page.getByLabel("Name", { exact: true }).fill("E2E Docpipe");
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

    // 1. Upload: lands QUEUED automatically (no second action).
    await page.getByRole("tab", { name: /materials/i }).click();
    await expect(page).toHaveURL(/tab=materials/);
    const pdf = buildPdfBuffer([
      `Calibration notes ${uniqueTerm}`,
      "The quick brown fox jumps over the lazy dog",
    ]);
    await page.getByLabel("Choose a PDF to upload").setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: pdf,
    });
    await expect(page.getByText(filename)).toBeVisible({ timeout: 30000 });

    // 2. Processing → 3. Ready: the worker extracts text, stores the
    // page, and chains knowledge indexing (mock embeddings in the E2E
    // worker). The list polls while work is active. pageCount is only
    // set when the document reaches READY.
    await expect(page.getByText("1 pages")).toBeVisible({ timeout: 180000 });

    // 4. Searchable: the extracted text is retrievable (lexical path).
    // The unique term appears in the result content (the filename never
    // contains it), scoped with the "Page 1" citation badge.
    await page.getByRole("textbox", { name: /search project materials/i }).fill(uniqueTerm);
    await page.getByRole("button", { name: /^search$/i }).click();
    await expect(page.getByText("1 result")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Page 1").first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(uniqueTerm).first()).toBeVisible({ timeout: 60000 });
  });
});
