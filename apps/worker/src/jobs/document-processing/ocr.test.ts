import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  DisabledOcrProvider,
  OcrUnavailableError,
  TesseractOcrProvider,
  createOcrProvider,
} from "./ocr.js";

const providers: TesseractOcrProvider[] = [];

async function ocrFixture(): Promise<Buffer> {
  const svg =
    `<svg width="600" height="120" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="600" height="120" fill="white"/>` +
    `<text x="20" y="70" font-size="44" font-family="sans-serif" fill="black">Zephyr 12345</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("OCR providers (tesseract.js, vendored language data)", () => {
  afterAll(async () => {
    for (const provider of providers) {
      await provider.close().catch(() => undefined);
    }
    providers.length = 0;
  });

  it("disabled provider throws OcrUnavailableError instead of fabricating text", async () => {
    const provider = new DisabledOcrProvider();
    await expect(provider.recognize(Buffer.from([1, 2, 3]))).rejects.toBeInstanceOf(
      OcrUnavailableError
    );
  });

  it("factory honors enabled:false", async () => {
    const provider = createOcrProvider({ enabled: false });
    expect(provider).toBeInstanceOf(DisabledOcrProvider);
  });

  it("recognizes rendered text offline with the vendored eng data", async () => {
    const png = await ocrFixture();
    const provider = new TesseractOcrProvider({
      cachePath: "C:\\Users\\karthik\\AppData\\Local\\Temp\\opencode\\tess-cache-test",
    });
    providers.push(provider);
    const result = await provider.recognize(png);
    expect(result.text).toContain("Zephyr");
    expect(result.confidence).toBeGreaterThan(0);
  }, 60_000);
});
