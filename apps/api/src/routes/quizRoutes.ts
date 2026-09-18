import { Router } from "express";
import {
  completeAttemptHandler,
  createQuizHandler,
  getAttemptHandler,
  getQuizHandler,
  listConceptsHandler,
  listQuizzesHandler,
  startAttemptHandler,
  submitResponseHandler,
} from "../controllers/quizController.js";
import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "../config/index.js";

/**
 * POST /api/projects/:projectId/quizzes — adaptive generation (expensive:
 * strict limiter, each call fans out to concept extraction + batched Groq).
 * GET  /api/projects/:projectId/quizzes — list (counts, no payloads).
 * GET  /api/projects/:projectId/concepts — concept list for focus mode.
 * GET  /api/quizzes/:quizId — detail (answer keys stripped).
 * POST /api/quizzes/:quizId/attempts — start or resume an attempt.
 * GET  /api/quiz-attempts/:attemptId — attempt state (keys only for answered).
 * POST /api/quiz-attempts/:attemptId/responses — submit one answer.
 * POST /api/quiz-attempts/:attemptId/complete — score + assessment records.
 */
export function createQuizRouter(): Router {
  const router: Router = Router();

  const generateLimiter = createRateLimiter({
    windowMs: config.QUIZ_GENERATE_RATE_LIMIT_WINDOW_MS,
    max: config.QUIZ_GENERATE_RATE_LIMIT_MAX,
    namespace: "quiz-generate",
  });
  const quizLimiter = createRateLimiter({
    windowMs: config.QUIZ_RATE_LIMIT_WINDOW_MS,
    max: config.QUIZ_RATE_LIMIT_MAX,
    namespace: "quiz",
  });

  router.post("/api/projects/:projectId/quizzes", generateLimiter, ...createQuizHandler);
  router.get("/api/projects/:projectId/quizzes", ...listQuizzesHandler);
  router.get("/api/projects/:projectId/concepts", ...listConceptsHandler);
  router.get("/api/quizzes/:quizId", ...getQuizHandler);
  router.post("/api/quizzes/:quizId/attempts", quizLimiter, ...startAttemptHandler);
  router.get("/api/quiz-attempts/:attemptId", ...getAttemptHandler);
  router.post("/api/quiz-attempts/:attemptId/responses", quizLimiter, ...submitResponseHandler);
  router.post("/api/quiz-attempts/:attemptId/complete", quizLimiter, ...completeAttemptHandler);

  return router;
}
