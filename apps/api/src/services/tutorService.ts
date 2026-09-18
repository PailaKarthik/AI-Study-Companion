import type { Prisma, PrismaClient } from "@ai-study-companion/db";
import {
  GroqChatProvider,
  isTimeoutError,
  recordAIUsage,
  type ChatCompletionProvider,
  type EmbeddingProvider,
} from "@ai-study-companion/ai";
import type {
  ConversationDetail,
  ConversationSummary,
  SearchResultItem,
  TutorAskResponse,
  TutorEvidenceItem,
  TutorMessageItem,
} from "@ai-study-companion/shared";
import { config } from "../config/index.js";
import { AppError } from "../errors/AppError.js";
import { NotFoundError } from "../errors/AppError.js";
import { logger } from "../lib/logger.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { enqueueAIEvaluation, isQueueConfigured } from "../lib/queues.js";
import { requireDb } from "../repositories/base.js";
import { getOwnedProjectOrThrow } from "./accessService.js";
import { recordActivity } from "./activityService.js";
import { linkChunksToConcepts, recordTutorEngagement } from "./masteryService.js";
import { searchProject } from "./searchService.js";
import {
  buildTutorSystemPrompt,
  buildTutorUserPrompt,
  formatCitationLabel,
  titleFromQuestion,
  toEvidenceBlocks,
  type TutorHistoryTurn,
} from "./tutorPrompts.js";

export interface AskTutorInput {
  message: string;
  conversationId?: string;
}

export interface AskTutorOptions {
  db?: PrismaClient;
  requestId?: string;
  /** Injected in tests; production builds Groq from config. */
  chat?: ChatCompletionProvider | null;
  /** Passed through to retrieval; injected in tests. */
  embedder?: EmbeddingProvider | null;
}

/**
 * Test-only chat override (HTTP tests cannot inject through Express).
 * `undefined` = production behavior; a provider (or null) forces that path.
 * Always reset in afterEach — leaked overrides would poison other suites.
 */
let testChatOverride: ChatCompletionProvider | null | "unset" = "unset";

export function __setTutorChatForTests(provider: ChatCompletionProvider | null | undefined): void {
  testChatOverride = provider === undefined ? "unset" : provider;
}

function resolveChat(explicit?: ChatCompletionProvider | null): ChatCompletionProvider | null {
  if (explicit) return explicit;
  if (explicit === null) return null;
  if (testChatOverride !== "unset") return testChatOverride;
  if (!config.GROQ_API_KEY) return null;
  return new GroqChatProvider({
    apiKey: config.GROQ_API_KEY,
    model: config.GROQ_CHAT_MODEL,
    timeoutMs: config.TUTOR_TIMEOUT_MS,
    maxAttempts: config.TUTOR_MAX_ATTEMPTS,
  });
}

type DbOrTx = PrismaClient | Prisma.TransactionClient;

/**
 * Maximum messages returned by getConversation (most-recent window).
 * Threads are append-only and unbounded; without a cap one giant thread
 * could force a multi-MB response. The LLM history window
 * (TUTOR_HISTORY_LIMIT) is unaffected — this is purely a read bound.
 */
export const MAX_CONVERSATION_MESSAGES = 500;

async function recordTutorUsage(
  db: DbOrTx,
  input: {
    userId: string;
    projectId: string;
    provider: "GROQ" | "SYSTEM";
    model: string;
    requestId?: string;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    status: "SUCCESS" | "FAILED" | "TIMEOUT";
    error?: string;
    conversationId: string;
    grounded: boolean;
  }
): Promise<void> {
  // Cost flows from the central pricing table — no per-feature math here.
  const { conversationId, grounded, ...rest } = input;
  return recordAIUsage(db, {
    ...rest,
    feature: "TUTOR",
    metadata: { conversationId, grounded },
  });
}

/**
 * Project-scoped RAG tutor turn. Ownership is enforced through the project
 * chain (foreign ids → 404); retrieval reuses searchProject so evidence can
 * never cross project boundaries.
 *
 * Failure atomicity: retrieval + generation happen BEFORE any write, then
 * both messages + evidence persist in one transaction. A failed LLM call
 * leaves no dangling user message — the client retries the whole turn.
 */
export async function askTutor(
  userId: string,
  projectId: string,
  input: AskTutorInput,
  options: AskTutorOptions = {}
): Promise<TutorAskResponse> {
  const totalStarted = Date.now();
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);

  let conversationId = input.conversationId ?? null;
  if (conversationId) {
    const existing = await db.conversation.findFirst({
      where: { id: conversationId, projectId: owned.id, ownerId: userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundError("Conversation not found");
    }
  }

  const history: TutorHistoryTurn[] = [];
  if (conversationId) {
    const recent = await db.message.findMany({
      where: { conversationId, projectId: owned.id },
      orderBy: { sequence: "desc" },
      take: config.TUTOR_HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    for (const row of [...recent].reverse()) {
      if (row.role === "USER" || row.role === "ASSISTANT") {
        history.push({ role: row.role, content: row.content });
      }
    }
  }

  const retrieval = await searchProject(userId, owned.id, input.message, {
    limit: config.TUTOR_RETRIEVAL_LIMIT,
    db,
    embedder: options.embedder,
  });
  const grounded = retrieval.results.length > 0;
  const blocks = toEvidenceBlocks(retrieval.results);

  const chat = resolveChat(options.chat);
  if (!chat) {
    throw new AppError(
      "SERVICE_UNAVAILABLE",
      "The AI tutor is not configured yet. Set GROQ_API_KEY to enable tutoring."
    );
  }

  const systemPrompt = buildTutorSystemPrompt(grounded);
  const userPrompt = buildTutorUserPrompt(input.message, blocks, history);

  let answer: string;
  let model: string;
  let inputTokens: number;
  let outputTokens: number;
  let chatLatencyMs: number;
  try {
    const completed = await chat.complete({
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map((t) => ({
          role: (t.role === "USER" ? "user" : "assistant") as "user" | "assistant",
          content: t.content,
        })),
        { role: "user", content: userPrompt },
      ],
      maxTokens: config.TUTOR_MAX_TOKENS,
      temperature: 0.3,
    });
    answer = completed.content;
    model = completed.model;
    inputTokens = completed.inputTokens;
    outputTokens = completed.outputTokens;
    chatLatencyMs = completed.latencyMs;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Timeouts are their own status — FAILED analytics must not swallow them.
    const timedOut = isTimeoutError(error);
    await recordTutorUsage(db, {
      userId,
      projectId: owned.id,
      provider: "GROQ",
      model: chat.model,
      requestId: options.requestId,
      latencyMs: Date.now() - totalStarted,
      inputTokens: Math.max(1, Math.ceil((systemPrompt.length + userPrompt.length) / 4)),
      outputTokens: 0,
      status: timedOut ? "TIMEOUT" : "FAILED",
      error: message.slice(0, 2000),
      conversationId: conversationId ?? "pending",
      grounded,
    }).catch(() => undefined);
    // A failed turn persists nothing, but the failure itself is real
    // activity: it powers failure-rate analytics and retry UX.
    await recordActivity(db, {
      userId,
      spaceId: owned.spaceId,
      projectId: owned.id,
      eventType: "TUTOR_RESPONSE_FAILED",
      entityType: "conversation",
      entityId: conversationId ?? undefined,
      ...(options.requestId
        ? { idempotencyKey: `tutor-response-failed:${options.requestId}` }
        : {}),
      metadata: { feature: "tutor", grounded },
    }).catch(() => undefined);
    logger.warn(
      { projectId: owned.id, conversationId, grounded, error: message },
      "Tutor generation failed; nothing persisted"
    );
    const retryable =
      typeof (error as { retryable?: unknown })?.retryable === "boolean"
        ? (error as { retryable: boolean }).retryable
        : true;
    throw new AppError(
      retryable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR",
      retryable
        ? "The tutor is temporarily unavailable. Please try again."
        : "The tutor failed to answer. Please try again."
    );
  }

  // Persist with bounded retries on the (conversationId, sequence) unique
  // key: two simultaneous turns read the same max sequence; the loser gets
  // P2002 and retries with a fresh sequence instead of failing the turn.
  // Nothing is half-written — each attempt is one atomic transaction.
  const result = await persistTutorTurn(db, owned, userId, input, {
    conversationId,
    answer,
    model,
    chatLatencyMs,
    retrievalCount: retrieval.results.length,
    retrievalResults: retrieval.results,
    requestId: options.requestId,
  });

  // Exposure markers for quizzed concepts discussed here (score-neutral —
  // a good chat is not proof of understanding). Best-effort: these rows
  // are display-only history, so a marker failure must never 500 a chat
  // turn the user already received.
  if (retrieval.results.length > 0) {
    try {
      const chunkIds = retrieval.results
        .map((r) => r.chunkId)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      const conceptIds = await linkChunksToConcepts(db, owned.id, chunkIds);
      await recordTutorEngagement(userId, owned.id, result.assistantId, conceptIds, { db });
    } catch (error) {
      logger.warn(
        { projectId: owned.id, conversationId: result.conversationId, error: String(error) },
        "Tutor engagement markers skipped"
      );
    }
  }

  await recordTutorUsage(db, {
    userId,
    projectId: owned.id,
    provider: chat.name === "mock" ? "SYSTEM" : "GROQ",
    model,
    requestId: options.requestId,
    latencyMs: chatLatencyMs,
    inputTokens,
    outputTokens,
    status: "SUCCESS",
    conversationId: result.conversationId,
    grounded,
  });

  // Quality evaluation runs async in the worker — never blocks the turn.
  // Best-effort: without Redis configured there is simply no evaluation.
  if (isQueueConfigured()) {
    await enqueueAIEvaluation(
      "tutor_message",
      result.assistantId,
      options.requestId ?? `tutor-${result.assistantId}`
    ).catch((error: unknown) =>
      logger.warn(
        {
          messageId: result.assistantId,
          error: error instanceof Error ? error.message : String(error),
        },
        "AI evaluation enqueue skipped"
      )
    );
  }

  const totalMs = Date.now() - totalStarted;
  logger.info(
    {
      projectId: owned.id,
      conversationId: result.conversationId,
      grounded,
      evidenceCount: retrieval.results.length,
      chatLatencyMs,
      totalMs,
    },
    "Tutor turn completed"
  );

  const evidence: TutorEvidenceItem[] = retrieval.results.map((r) => ({
    chunkId: r.chunkId,
    materialId: r.materialId,
    materialName: r.materialName,
    pageId: r.pageId,
    pageNumber: r.pageNumber,
    relevanceScore: r.score,
    citationLabel: formatCitationLabel(r.materialName, r.pageNumber),
  }));

  return {
    conversationId: result.conversationId,
    messageId: result.assistantId,
    answer,
    evidence,
    model,
    latencyMs: chatLatencyMs,
    grounded,
  };
}

interface PersistTurnInput {
  conversationId: string | null;
  answer: string;
  model: string;
  chatLatencyMs: number;
  retrievalCount: number;
  retrievalResults: SearchResultItem[];
  requestId?: string;
}

/**
 * Persist one tutor turn atomically (2 messages + evidence + activities).
 * Retries the whole transaction up to MAX_PERSIST_ATTEMPTS on P2002: a
 * concurrent turn on the same conversation read the same max sequence and
 * won the unique (conversationId, sequence) key. Each attempt re-reads the
 * max sequence, so the retry always lands on fresh numbers. Any other
 * error propagates — the turn fails with nothing persisted (fail-closed,
 * client retries the whole turn).
 */
const MAX_PERSIST_ATTEMPTS = 3;

async function persistTutorTurn(
  db: PrismaClient,
  owned: { id: string; spaceId: string },
  userId: string,
  input: AskTutorInput,
  turn: PersistTurnInput
): Promise<{ conversationId: string; assistantId: string }> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_PERSIST_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          let cid = turn.conversationId;
          if (!cid) {
            const created = await tx.conversation.create({
              data: {
                projectId: owned.id,
                ownerId: userId,
                title: titleFromQuestion(input.message),
              },
              select: { id: true },
            });
            cid = created.id;
          }
          const last = await tx.message.findFirst({
            where: { conversationId: cid },
            orderBy: { sequence: "desc" },
            select: { sequence: true },
          });
          const userSequence = (last?.sequence ?? 0) + 1;
          const assistantSequence = userSequence + 1;

          await tx.message.create({
            data: {
              conversationId: cid,
              projectId: owned.id,
              role: "USER",
              content: input.message,
              sequence: userSequence,
            },
          });
          const assistant = await tx.message.create({
            data: {
              conversationId: cid,
              projectId: owned.id,
              role: "ASSISTANT",
              content: turn.answer,
              sequence: assistantSequence,
              metadata: {
                model: turn.model,
                chatLatencyMs: turn.chatLatencyMs,
                retrievalResultCount: turn.retrievalCount,
                evidenceCount: turn.retrievalCount,
              },
            },
            select: { id: true },
          });
          if (turn.retrievalResults.length > 0) {
            await tx.tutorEvidence.createMany({
              data: turn.retrievalResults.map((r, i) => ({
                messageId: assistant.id,
                chunkId: r.chunkId,
                materialId: r.materialId,
                pageId: r.pageId,
                pageNumber: r.pageNumber,
                relevanceScore: r.score,
                citationLabel: formatCitationLabel(r.materialName, r.pageNumber),
                metadata: { rank: i + 1 },
              })),
            });
          }
          await tx.conversation.update({
            where: { id: cid },
            data: { lastMessageAt: new Date() },
          });
          if (!turn.conversationId) {
            await recordActivity(tx, {
              userId,
              spaceId: owned.spaceId,
              projectId: owned.id,
              eventType: "TUTOR_CONVERSATION_CREATED",
              entityType: "conversation",
              entityId: cid,
              metadata: { feature: "tutor" },
            });
          }
          await recordActivity(tx, {
            userId,
            spaceId: owned.spaceId,
            projectId: owned.id,
            eventType: "TUTOR_INTERACTION",
            entityType: "conversation",
            entityId: cid,
          });
          return { conversationId: cid, assistantId: assistant.id };
        },
        { timeout: 15_000 }
      );
    } catch (error) {
      lastError = error;
      if (isUniqueViolation(error) && attempt < MAX_PERSIST_ATTEMPTS) {
        logger.warn(
          { projectId: owned.id, conversationId: turn.conversationId, attempt },
          "Tutor persist raced on message sequence; retrying with fresh numbers"
        );
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

function toTutorMessageItem(row: {
  id: string;
  role: string;
  content: string;
  sequence: number;
  createdAt: Date;
  evidence: {
    chunkId: string | null;
    materialId: string;
    pageId: string | null;
    pageNumber: number | null;
    relevanceScore: number | null;
    citationLabel: string | null;
  }[];
}): TutorMessageItem {
  const evidence = [...row.evidence].map((e) => ({
    chunkId: e.chunkId,
    materialId: e.materialId,
    materialName: "",
    pageId: e.pageId,
    pageNumber: e.pageNumber,
    relevanceScore: e.relevanceScore,
    citationLabel: e.citationLabel ?? "Source",
  }));
  return {
    id: row.id,
    role: row.role === "ASSISTANT" ? "ASSISTANT" : "USER",
    content: row.content,
    sequence: row.sequence,
    createdAt: row.createdAt.toISOString(),
    evidence,
  };
}

export async function listConversations(
  userId: string,
  projectId: string,
  options: { db?: PrismaClient } = {}
): Promise<ConversationSummary[]> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const rows = await db.conversation.findMany({
    where: { projectId: owned.id, ownerId: userId },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { _count: { select: { messages: true } } },
  });
  return rows.map((c) => ({
    id: c.id,
    projectId: c.projectId,
    title: c.title,
    messageCount: c._count.messages,
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }));
}

export async function getConversation(
  userId: string,
  projectId: string,
  conversationId: string,
  options: { db?: PrismaClient } = {}
): Promise<ConversationDetail> {
  const db = options.db ?? requireDb();
  const owned = await getOwnedProjectOrThrow(userId, projectId, db);
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, projectId: owned.id, ownerId: userId },
    include: {
      // Bounded window: threads grow without limit, so the API returns at
      // most MAX_CONVERSATION_MESSAGES most-recent messages and flags
      // truncation (LLM history is separately capped by TUTOR_HISTORY_LIMIT).
      _count: { select: { messages: true } },
      messages: {
        orderBy: { sequence: "desc" },
        take: MAX_CONVERSATION_MESSAGES + 1,
        include: { evidence: true },
      },
    },
  });
  if (!conversation) {
    throw new NotFoundError("Conversation not found");
  }
  const messagesTruncated = conversation.messages.length > MAX_CONVERSATION_MESSAGES;
  const windowed = conversation.messages
    .slice(0, MAX_CONVERSATION_MESSAGES)
    .sort((a, b) => a.sequence - b.sequence);
  // Material names are not stored on evidence rows; resolve per message.
  const materialIds = [...new Set(windowed.flatMap((m) => m.evidence.map((e) => e.materialId)))];
  const materials =
    materialIds.length > 0
      ? await db.material.findMany({
          where: { id: { in: materialIds } },
          select: { id: true, filename: true },
        })
      : [];
  const nameById = new Map(materials.map((m) => [m.id, m.filename]));
  return {
    id: conversation.id,
    projectId: conversation.projectId,
    title: conversation.title,
    messageCount: conversation._count.messages,
    lastMessageAt: conversation.lastMessageAt ? conversation.lastMessageAt.toISOString() : null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages: windowed.map((m) => withMaterialNames(toTutorMessageItem(m), nameById)),
    messagesTruncated,
  };
}

function withMaterialNames(
  item: TutorMessageItem,
  nameById: Map<string, string>
): TutorMessageItem {
  return {
    ...item,
    evidence: item.evidence.map((e) => ({
      ...e,
      materialName: nameById.get(e.materialId) ?? "Material",
    })),
  };
}
