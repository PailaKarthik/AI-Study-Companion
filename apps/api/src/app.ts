import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config/index.js";
import { initSentry } from "./lib/sentry.js";
import { csrfOriginCheck } from "./middleware/csrf.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { rateLimiterMiddleware } from "./middleware/rateLimit.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { requestLoggerMiddleware } from "./middleware/requestLogger.js";
import { createApiRouter } from "./routes/index.js";
import type { AuthRouterOptions } from "./routes/authRoutes.js";

initSentry();

export interface CreateAppOptions {
  auth?: AuthRouterOptions;
}

export function createApp(options: CreateAppOptions = {}): express.Express {
  const app = express();

  app.disable("x-powered-by");
  // Trust exactly the configured proxy hops: too few breaks req.ip
  // (rate-limit keys, Secure cookies) behind a real proxy chain, too many
  // lets a client spoof x-forwarded-for. See TRUST_PROXY_HOPS.
  app.set("trust proxy", config.TRUST_PROXY_HOPS);

  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(
    helmet({
      // Cookies carry auth; same-site frontend needs no special CSP here,
      // but keep a tight baseline (Prompt 1 headers preserved).
      crossOriginEmbedderPolicy: false,
      // JSON-only API: deny framing, lock down everything by default.
      // Safe because this server never serves HTML/JS.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        },
      },
      frameguard: { action: "deny" },
      referrerPolicy: { policy: "no-referrer" },
      // HSTS only over TLS in production; harmless elsewhere (helmet
      // emits it whenever enabled, browsers ignore it on plain HTTP).
      hsts: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    })
  );
  app.use(
    cors({
      origin: config.API_CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    })
  );
  // Reasonable body limits for JSON APIs. Raw PDF bodies are parsed
  // per-route (see materialsRoutes) with their own ceiling.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));
  // Unsigned: session tokens are opaque + HMAC-verified server-side.
  app.use(cookieParser());

  app.use(rateLimiterMiddleware);
  app.use(csrfOriginCheck);
  app.use(createApiRouter(options.auth));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
