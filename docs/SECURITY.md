# Security

## 1. Authentication architecture

Custom server-managed sessions (no Auth provider, no JWTs):

```text
Browser (httpOnly cookie only)
   ↓  Cookie: asc_session=<256-bit opaque token>
Express API → validateSessionToken() → fresh User row → req.auth
   ↓
PostgreSQL sessions table (HMAC-SHA256 of token, never the raw token)
```

- The browser only ever holds the cookie. No tokens in `localStorage` /
  `sessionStorage` (a web test asserts `localStorage` is never read).
- Endpoints: `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me` (all under `/api/auth`).
- Passwords: Argon2id (`argon2` package, OWASP-tuned: m=19MiB, t=2, p=1).
  No custom crypto. Hashes live in `users.passwordHash` (nullable so
  pre-auth / future-OAuth rows can't password-login).
- `users.isActive` is an admin kill-switch: inactive users fail login with
  the generic 401 and their sessions validate as expired.

## 2. Session architecture

- Token: 256-bit `randomBytes`, base64url cookie value (44 chars).
- Stored: `sessions.tokenHash = HMAC-SHA256(token, SESSION_SECRET)` (unique),
  `userId`, `expiresAt` (TTL default 7d), `lastUsedAt`, `userAgent` (512),
  `ipAddress`. Raw tokens exist only in the cookie.
- Validation (`validateSessionToken`): token → hash → row → expiry →
  user fresh-load + `isActive` → throttled `lastUsedAt` touch (15 min).
  Expired/inactive sessions are deleted on sight; logout deletes by hash
  (idempotent — unknown tokens still return 200 + cleared cookie).
- Hygiene without a cron: every login/registration prunes that user's
  expired sessions and evicts oldest-first beyond 20 active sessions
  (`pruneSessionsForUser`; best-effort, never blocks auth; proven by
  `hardening.test.ts`).
- `GET /me` returns `{ id, name, email, role }` only.

## 3. Cookie security

`httpOnly: true` always; `secure: true` in production (or with
`SameSite=None`, which browsers require); `sameSite` env-configurable
(default `lax`); `path: /`; `maxAge` = TTL. Cleared with identical
attributes on logout. `SESSION_SECRET` (≥32 random chars) is validated at
startup in production — boot fails on placeholders/short secrets, with no
fallback secrets anywhere.

## 4. Password hashing

Argon2id via the maintained `argon2` package (native, verified working in
this repo). Chosen over bcrypt for memory-hardness and the prompt's
preference; `bcryptjs` was the fallback and wasn't needed.

## 5. Authorization

`requireAuth` (cookie → session → `req.auth: AuthenticatedUser`, typed —
no `as any` outside the single contained assignment in the middleware),
`requireAdmin` (adds server-verified `role === ADMIN`), `requireSpaceOwner`
/ `requireProjectAccess` (ownership-encoded `findFirst({ id, ownerId })`,
attach `ownedSpace`/`ownedProject`). Services receive identity explicitly;
`getOwnedSpaceOrThrow` / `getOwnedProjectOrThrow` / `assertProjectAccess`
live in `services/accessService.ts`, not controllers.

Hardening (Prompt 12): mutating Space/Project writes verify ownership
INSIDE the same transaction as the write (`getOwned*OrThrow(userId, …,
tx)`), closing the check-then-act window; quiz/conversation lookups use
atomic relation filters (`{ id, project: { ownerId } }`) instead of
fetch-then-JS-check. Ownership itself is immutable (no transfer
endpoint), so the residual window was never exploitable — the change is
defense in depth, proven by `hardening.test.ts` + unchanged
`isolation.test.ts`/`authorization.test.ts`.

## 6. Project isolation

`authenticatedUserId → Space ownership → Project ownership → resource`.
Project queries always encode `ownerId`; `assertProjectAccess` additionally
binds `spaceId` to catch moved/inconsistent rows.

## 7. IDOR protection

Cross-user misses return **404 NOT_FOUND** (`"Space/Project not found"`),
byte-identical per resource type to a genuinely missing id (proven by
`isolation.test.ts`, which asserts full error-body equality between
"Bob's project via Alice" and "random UUID"). Malformed UUIDs are also 404.
There is no 403-vs-404 oracle and no existence leak.

## 8. CORS

Exact-origin allowlist from `API_CORS_ORIGIN` (default
`http://localhost:3000`), `credentials: true`. Never `*` with cookies —
startup now FAILS if any entry is `*` or not a valid origin
(`assertCorsOrigins`; covered by `hardening.test.ts`, which asserts an
unknown `Origin` gets no `access-control-allow-origin`).

## 9. CSRF decision

Primary defense: `SameSite=Lax` (default) — browsers withhold the session
cookie on cross-site `fetch`/POST, which is the CSRF vector for a
same-site API + web setup. Defense in depth: `csrfOriginCheck` rejects
state-changing requests whose `Origin`/`Referer` matches neither the
request host nor the configured web/API origins (403 FORBIDDEN, covered by
tests). Non-browser clients send no `Origin` and pass through with the
cookie still required. If production ever splits web/API cross-site,
switch `SESSION_SAMESITE=none` (forces `Secure`); token-based CSRF was
deemed unnecessary for this prototype and is documented as future work.

## 10. Rate limiting

Global generous limiter + strict per-route `register`/`login` limiters
(defaults 20/30 per 15 min, env-overridable via
`AUTH_REGISTER_RATE_LIMIT_MAX` / `AUTH_LOGIN_RATE_LIMIT_MAX` /
`AUTH_RATE_LIMIT_WINDOW_MS`; tests inject tiny caps deterministically).

Hardening (Prompt 12): the store is now Redis-backed (fixed-window
counters via the shared Upstash/TCP connection) with automatic
in-memory fallback per key — limits hold across replicas, and a down
Redis degrades to per-instance limiting instead of failing open or
closed. Login is keyed by IP + normalized email, so IP rotation cannot
brute-force one account and one NAT IP cannot lock out unrelated
accounts (proven by `hardening.test.ts`: same-email 3rd attempt → 429
while a different email on the same IP still gets 401). 429s use the
central `RATE_LIMITED` envelope + `Retry-After`.

Also security-hardened: `TRUST_PROXY_HOPS` (default 1) replaces the
hardcoded `trust proxy` so `req.ip` (limiter keys, Secure cookies)
matches the real proxy topology; API headers now include a JSON-safe
CSP (`default-src 'none'`, `frame-ancestors 'none'`), `X-Frame-Options:
DENY`, `Referrer-Policy: no-referrer`, and HSTS in production.

## 11. Input validation

Zod everywhere via `@ai-study-companion/validation` (body/params/query
middleware; strict centralized `VALIDATION_ERROR`). Limits: email ≤254
(normalized trim+lowercase), passwords 8–128, names ≤100, UUID params,
pagination caps, 1 MB JSON bodies. Future ceilings pre-shipped
(`tutorMessageSchema`, `quizResponseTextSchema`, … ≤8000) without features.

## 12. Sensitive-data logging policy

Never logged: passwords, hashes, session tokens, cookies, `Authorization`,
API keys, `DATABASE_URL`, `SESSION_SECRET`. Enforced by pino `redact`
paths (`req.headers.cookie`, `req.cookies`, `*.tokenHash`,
`*.passwordHash`, `*.sessionToken`, secrets). Verified: request logs show
`"cookie":"[REDACTED]"`. Request bodies are never logged.

## 13. Secret management

`.env` (never committed) → typed `config/index.ts` (the only
`process.env` reader). No defaults for production secrets; startup throws
otherwise. Test DB is selected via `TEST_DATABASE_URL` only, with a
fail-fast guard refusing `TEST == outer DATABASE_URL`.

## 14. Admin authorization

`requireAdmin` = `requireAuth` + DB-verified `role === ADMIN`. The
frontend `RequireAdmin` guard reads `/me` for UX routing only; every admin
API decision is server-side. `/admin` page is wrapped; non-admins route to
`/spaces`, anonymous to `/login`.

## 15. Security limitations (honest)

- Register duplicate-email returns 409 `"An account with this email already
exists"` (mild enumeration oracle, accepted for prototype UX; login,
  which is the credential attack surface, is fully generic + rate-limited).
- No email verification, password reset, 2FA, or session device list yet
  (`revokeAllUserSessions` exists as a tested repository helper with no
  product caller until a password-change/compromise flow needs it).
- No token-CSRF (see §9); login has no per-account lockout counter beyond
  the per-email rate limiter.
- Login timing equalized via dummy-hash verify on missing accounts.
- Audit trail of auth events: structured logs only (`user_registered`,
  `user_login` with `userId`); no PII beyond userId.
- Upload validation is enforced server-side (declared MIME allowlist,
  `%PDF-` magic bytes, size ceiling, filename sanitization, per-project
  checksum dedup) — see `docs/RELIABILITY.md` §8 and §17 below.

## 17. File storage access (Neon Object Storage bucket)

PDF/image bytes live in the Neon Object Storage bucket (S3-compatible,
private) — PostgreSQL holds only metadata rows. No public objects; the
browser never receives anything but authenticated API responses, and
bucket credentials never leave the server (validated config, Secret-free
logs, production boot fails fast when incomplete).

- **Server-side authorization**: every byte read/write/delete goes
  through `materialsService`, which verifies project ownership first
  (unknown + foreign → identical 404). The storage provider itself
  (`packages/db/src/storage.ts`) is byte mechanics only and trusts
  nothing from the client.
- **Project isolation**: objects are keyed
  `users/<u>/spaces/<s>/projects/<p>/materials/<m>/…`
  and always resolved via the owning material's `storageKey`; keys are
  never client-supplied (image ids address metadata rows, never bucket
  paths), so one project cannot address another's bytes.
- **Secure retrieval**: downloads stream server-side with SHA-256
  verification against the material checksum (`ETag`); a mismatch
  refuses the download and logs an error.
- **File validation**: `Content-Type: application/pdf` required,
  `%PDF-` magic bytes decisive, empty files rejected, size capped by
  `STORAGE_MAX_UPLOAD_BYTES` (400s, nothing stored on failure).
- **Temporary files**: none — bytes flow memory → bucket on upload
  (compensating delete on metadata failure); extraction renders nothing
  to disk (pdfjs headless, sharp in-memory PNGs, in-process OCR), so
  there is no temp-file staging to clean up on success, retry, or crash.
- **Pipeline authorization**: the worker resolves bytes only via the
  material's own `storageKey`; `reprocess` re-checks ownership +
  stored-bytes presence (byte-less rows → re-upload 404, never another
  project's bytes); search evidence is project-scoped in SQL, so one
  project can never retrieve another's chunks.
- **Credential handling**: bucket credentials (`AWS_*`) live only in server
  environment (validated at boot, redacted from logs); objects inherit
  the branch-scoped bucket's isolation, metadata inherits
  Neon PostgreSQL semantics (see `docs/DEPLOYMENT.md` §8/§10).

## 16. Future hardening

Email verification + reset flow, refresh/access token rotation option,
`Session` device listing + "revoke all" UI, failed-login lockout
counters, anomaly alerts, admin audit log.
