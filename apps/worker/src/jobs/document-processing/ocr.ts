import { existsSync } from "node:fs";
import path from "node:path";
import { createWorker, type Worker as OcrWorker } from "tesseract.js";
import { logger } from "../../lib/logger.js";
import { workerConfig } from "../../config/index.js";

/**
 * OCR fallback for image-only (scanned) pages (tesseract.js, local).
 *
 * Only pages whose extracted text is below the caller's threshold reach
 * OCR — text pages never pay the OCR cost. Recognition runs fully
 * in-process: language data loads from the vendored
 * `apps/worker/assets/tessdata/eng.traineddata` by default
 * (`TESSERACT_LANG_PATH` overrides), so jobs work offline with no CDN
 * dependency. A missing engine/data never fabricates text: providers
 * throw `OcrUnavailableError` and the caller records the page honestly.
 */

export interface OcrResult {
  text: string;
  confidence: number;
}

export interface OcrProvider {
  readonly name: string;
  recognize(png: Buffer): Promise<OcrResult>;
  close(): Promise<void>;
}

export class OcrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrUnavailableError";
  }
}

/** OCR disabled by configuration — always unavailable, never silent. */
export class DisabledOcrProvider implements OcrProvider {
  readonly name = "disabled";
  async recognize(_png: Buffer): Promise<OcrResult> {
    throw new OcrUnavailableError("OCR is disabled (DOCUMENT_OCR_ENABLED=false).");
  }
  async close(): Promise<void> {}
}

export interface TesseractOptions {
  language?: string;
  /** Directory holding `<lang>.traineddata`. Defaults to vendored tessdata. */
  langPath?: string | null;
  /** Writable cache directory for tesseract.js internals. */
  cachePath?: string;
}

/**
 * Resolve the tessdata directory: explicit override → vendored asset →
 * null (caller falls back to the tesseract.js CDN default, logged).
 */
export function resolveTessdataDir(explicit?: string | null): string | null {
  if (explicit && explicit.trim().length > 0) return explicit;
  if (workerConfig.TESSERACT_LANG_PATH.trim().length > 0) {
    return workerConfig.TESSERACT_LANG_PATH;
  }
  const vendored = path.join(process.cwd(), "assets", "tessdata");
  if (existsSync(path.join(vendored, "eng.traineddata"))) return vendored;
  return null;
}

/** tesseract.js provider with one lazily-created worker, serialized calls. */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = "tesseract";
  private worker: OcrWorker | null = null;
  private creating: Promise<OcrWorker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly language: string;
  private readonly langPath: string | null;
  private readonly cachePath: string | undefined;

  constructor(options: TesseractOptions = {}) {
    this.language = options.language ?? "eng";
    this.langPath = options.langPath !== undefined ? options.langPath : resolveTessdataDir();
    this.cachePath = options.cachePath;
  }

  private async getWorker(): Promise<OcrWorker> {
    if (this.worker) return this.worker;
    if (!this.creating) {
      this.creating = (async () => {
        try {
          const workerOptions: Record<string, unknown> = { gzip: false };
          if (this.langPath) workerOptions.langPath = this.langPath;
          if (this.cachePath) workerOptions.cachePath = this.cachePath;
          const created = await createWorker(this.language, 1, workerOptions);
          this.worker = created;
          logger.info(
            { langPath: this.langPath ?? "<tesseract.js CDN default>" },
            "OCR worker ready"
          );
          return created;
        } catch (error) {
          this.creating = null;
          const message = error instanceof Error ? error.message : String(error);
          throw new OcrUnavailableError(`OCR engine failed to start: ${message}`);
        }
      })();
    }
    return this.creating;
  }

  async recognize(png: Buffer): Promise<OcrResult> {
    // tesseract workers are single-job: serialize to avoid interleaving.
    const run = this.queue.then(async () => {
      const worker = await this.getWorker();
      try {
        const { data } = await worker.recognize(png);
        return {
          text: (data.text ?? "").replace(/[ \t]+/g, " ").trim(),
          confidence: typeof data.confidence === "number" ? data.confidence : 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new OcrUnavailableError(`OCR recognition failed: ${message}`);
      }
    });
    // Keep the chain alive for later calls even if this one rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.creating = null;
    if (worker) {
      await worker.terminate().catch((error: unknown) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          "OCR worker terminate failed"
        );
      });
    }
  }
}

export interface OcrProviderOptions extends TesseractOptions {
  enabled?: boolean;
}

/** Factory honoring DOCUMENT_OCR_ENABLED; disabled ⇒ explicit provider. */
export function createOcrProvider(options: OcrProviderOptions = {}): OcrProvider {
  const enabled = options.enabled ?? workerConfig.DOCUMENT_OCR_ENABLED;
  if (!enabled) return new DisabledOcrProvider();
  return new TesseractOcrProvider(options);
}
