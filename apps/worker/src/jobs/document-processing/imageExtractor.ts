import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import sharp from "sharp";
import { logger } from "../../lib/logger.js";
import { standardFontDataUrl } from "./pdfjsConfig.js";

/**
 * Embedded-image extraction (pdfjs-dist operator list + sharp).
 *
 * Headless: image XObjects resolve through `page.objs` without page
 * rendering (no canvas). Conversion is native-first: sharp decodes the
 * bytes as-is, which handles ENCODED images (JPEG/DCTDecode — the norm
 * for scanned PDFs — PNG, …). Only when native decode fails AND the
 * byte length matches a raw pixel layout (`width*height*{1,3,4}`) do we
 * fall back to raw interpretation (FlateDecode images). Channel count
 * is never assumed from metadata alone; undecodable images are counted
 * as skipped, never fabricated. All in memory — no temporary files.
 *
 * Masks (`paintImageMaskXObject`) are stencil data, not content images,
 * and are ignored. Images are capped per material (options.maxImages);
 * the rest count as skipped so the caller can report honestly.
 */

export interface ExtractedImage {
  pageNumber: number;
  /** Zero-based index within the page, in paint order. */
  index: number;
  width: number;
  height: number;
  /** PNG bytes (sharp-converted, in memory). */
  png: Buffer;
  sizeBytes: number;
}

export interface ImageExtractionResult {
  images: ExtractedImage[];
  /** XObjects examined (including skipped ones). */
  examined: number;
  skipped: number;
  skipReasons: string[];
}

export interface ImageExtractorOptions {
  maxImages?: number;
  /** Per-image resolve timeout (ms)._objs callbacks can hang on corrupt PDFs. */
  resolveTimeoutMs?: number;
}

export interface PdfImageExtractor {
  readonly name: string;
  extractImages(
    pdfBytes: Uint8Array,
    options?: ImageExtractorOptions
  ): Promise<ImageExtractionResult>;
}

interface RawImage {
  width: number;
  height: number;
  data: Uint8Array;
}

function channelsFor(raw: RawImage): number | null {
  const pixels = raw.width * raw.height;
  if (pixels <= 0) return null;
  if (raw.data.length === pixels) return 1;
  if (raw.data.length === pixels * 3) return 3;
  if (raw.data.length === pixels * 4) return 4;
  return null;
}

/**
 * Convert one image object's bytes to PNG. Native decode first
 * (encoded JPEG/PNG/… straight through sharp); raw pixel fallback
 * second (only when dimensions match a raw layout). Returns null with
 * the reason when neither works.
 */
async function toPng(raw: RawImage): Promise<{ png: Buffer; via: "native" | "raw" } | null> {
  const input = Buffer.from(raw.data);
  try {
    const png = await sharp(input).png().toBuffer();
    return { png, via: "native" };
  } catch {
    // Not a self-describing encoding — try raw pixels if plausible.
  }
  const channels = channelsFor(raw);
  if (!channels) return null;
  try {
    const png = await sharp(input, {
      raw: { width: raw.width, height: raw.height, channels: channels as 1 | 3 | 4 },
    })
      .png()
      .toBuffer();
    return { png, via: "raw" };
  } catch {
    return null;
  }
}

/** pdfjs-dist paint op for image XObjects (verified 85 on pdfjs-dist v6). */
const PAINT_IMAGE_XOBJECT: number =
  (pdfjsLib as unknown as { OPS?: { paintImageXObject?: number } }).OPS?.paintImageXObject ?? 85;

function getImageObject(
  objs: { get: (name: string, callback: (img: unknown) => void) => void },
  name: string,
  timeoutMs: number
): Promise<RawImage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      objs.get(name, (img: unknown) => {
        clearTimeout(timer);
        if (
          typeof img === "object" &&
          img !== null &&
          typeof (img as { width?: unknown }).width === "number" &&
          typeof (img as { height?: unknown }).height === "number"
        ) {
          // pdfjs hands pixels back as Uint8Array (FlateDecode) or
          // Uint8ClampedArray (decoded JPEG) depending on the filter —
          // accept any byte view, never just one concrete class.
          const data = (img as { data?: unknown }).data;
          if (ArrayBuffer.isView(data) && !(data instanceof DataView)) {
            const typed = img as { width: number; height: number };
            resolve({
              width: typed.width,
              height: typed.height,
              data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
            });
            return;
          }
        }
        resolve(null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/** Headless pdfjs-dist + sharp image extraction. */
export class NodePdfImageExtractor implements PdfImageExtractor {
  readonly name = "pdfjs-sharp";

  async extractImages(
    pdfBytes: Uint8Array,
    options: ImageExtractorOptions = {}
  ): Promise<ImageExtractionResult> {
    const maxImages = options.maxImages ?? 50;
    const resolveTimeoutMs = options.resolveTimeoutMs ?? 15_000;
    const images: ExtractedImage[] = [];
    const skipReasons: string[] = [];
    let examined = 0;
    let skipped = 0;

    let document: {
      numPages: number;
      getPage: (n: number) => Promise<{
        getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
        objs: { get: (name: string, callback: (img: unknown) => void) => void };
        cleanup: () => void;
      }>;
      cleanup: () => void;
    };
    try {
      document = (await pdfjsLib.getDocument({
        data: pdfBytes,
        standardFontDataUrl: standardFontDataUrl(),
      }).promise) as typeof document;
    } catch (error) {
      // Text stage already classifies parse failures; here just report
      // zero images so the pipeline keeps its page work.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ error: message }, "PDF image pass: document open failed");
      return { images, examined, skipped, skipReasons: [`document open failed: ${message}`] };
    }

    try {
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const ops = await page.getOperatorList();
          let index = 0;
          for (let i = 0; i < ops.fnArray.length; i += 1) {
            if (ops.fnArray[i] !== PAINT_IMAGE_XOBJECT) continue;
            const args = ops.argsArray[i];
            const name = Array.isArray(args) ? args[0] : undefined;
            if (typeof name !== "string") continue;
            examined += 1;
            if (images.length >= maxImages) {
              skipped += 1;
              continue;
            }
            const raw = await getImageObject(page.objs, name, resolveTimeoutMs);
            if (!raw) {
              skipped += 1;
              skipReasons.push(`Page ${pageNumber} image ${name}: unresolvable bytes.`);
              continue;
            }
            // JPEG check first: pdfjs hands JPEG (DCTDecode) streams
            // through still-encoded, so byte length never matches a raw
            // layout — native sharp decode handles those.
            const converted = await toPng(raw);
            if (!converted) {
              skipped += 1;
              skipReasons.push(
                `Page ${pageNumber} image ${name}: ${raw.width}x${raw.height} with ${raw.data.length} bytes (undecodable as image).`
              );
              continue;
            }
            images.push({
              pageNumber,
              index,
              width: raw.width,
              height: raw.height,
              png: converted.png,
              sizeBytes: converted.png.length,
            });
            index += 1;
          }
        } finally {
          page.cleanup();
        }
      }
    } finally {
      document.cleanup();
    }
    return { images, examined, skipped, skipReasons };
  }
}
