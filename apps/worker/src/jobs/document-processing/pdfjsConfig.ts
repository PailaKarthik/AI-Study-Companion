import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Shared pdfjs-dist runtime configuration for headless extraction.
 *
 * `standardFontDataUrl` points at the standard 14 font files shipped
 * inside the pdfjs-dist npm package (`standard_fonts/`). Without it,
 * pdfjs logs `UnknownErrorException` and text extraction silently
 * returns EMPTY for PDFs that reference non-embedded standard fonts —
 * the single most common cause of "no extractable text" on real-world
 * PDFs. Resolved from the installed package location so it works under
 * tsx (src/), vitest, and compiled `node dist/` alike; `undefined`
 * preserves the old behavior if resolution ever fails.
 */
export function standardFontDataUrl(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve("pdfjs-dist/package.json");
    const url = pathToFileURL(join(dirname(packageJson), "standard_fonts")).href;
    return url.endsWith("/") ? url : `${url}/`;
  } catch {
    return undefined;
  }
}
