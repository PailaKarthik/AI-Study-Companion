import { createHmac, randomBytes } from "node:crypto";
import { config } from "../config/index.js";

/**
 * Opaque session tokens. 256-bit entropy, base64url-encoded for cookies.
 * Only the HMAC-SHA256 (keyed by SESSION_SECRET) is persisted — the raw
 * token never touches the database, logs, or API responses.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string = config.SESSION_SECRET): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}
