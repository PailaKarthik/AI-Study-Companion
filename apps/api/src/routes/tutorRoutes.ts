import { Router } from "express";
import {
  askTutorHandler,
  getConversationHandler,
  listConversationsHandler,
} from "../controllers/tutorController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * POST /api/projects/:projectId/tutor/ask — RAG tutor turn (retrieval +
 * Groq generation + persisted messages + citations).
 * GET  /api/projects/:projectId/conversations — thread list (latest first).
 * GET  /api/projects/:projectId/conversations/:conversationId — thread detail.
 *
 * Dedicated limiter: each ask can trigger one embedding + one chat call.
 */
export function createTutorRouter(): Router {
  const router: Router = Router();

  const tutorLimiter = createRateLimiter({
    windowMs: config.TUTOR_RATE_LIMIT_WINDOW_MS,
    max: config.TUTOR_RATE_LIMIT_MAX,
    namespace: "tutor",
  });

  router.post("/api/projects/:projectId/tutor/ask", tutorLimiter, ...askTutorHandler);
  router.get("/api/projects/:projectId/conversations", ...listConversationsHandler);
  router.get("/api/projects/:projectId/conversations/:conversationId", ...getConversationHandler);

  return router;
}
