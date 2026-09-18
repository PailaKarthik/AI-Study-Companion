/**
 * @ai-study-companion/shared
 *
 * Shared types, enums and API contracts.
 * Foundation only — feature types (spaces, projects, materials, …)
 * will be added in later prompts alongside the Prisma schema.
 */

export type ApiSuccess<T> = {
  success: true;
  data: T;
  requestId: string;
};

export type ApiFailure = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type HealthStatus = "ok" | "degraded";

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessResponse {
  status: "ready" | "not-ready";
  service: string;
  version: string;
  timestamp: string;
  checks: Record<string, { status: "up" | "down" | "skipped"; detail?: string }>;
}

// Pagination contract used by all list endpoints (future use).
export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

import type {
  ConceptDifficulty,
  ProjectStatus,
  QuestionType,
  QuizStatus,
  RecommendationPriority,
  RecommendationStatus,
  RecommendationType,
} from "./db.js";

/** Safe user payload returned by GET /api/auth/me. Never a password hash. */
export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
}

// ---------------------------------------------------------------------------
// Spaces / Projects (Prompt 5 — plain JSON-safe shapes, no Prisma)
// ---------------------------------------------------------------------------

export interface SpaceSummary {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpaceDetail extends SpaceSummary {}

export interface ProjectSummary {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  goal: string | null;
  status: ProjectStatus;
  materialCount: number;
  conceptCount: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface ProjectSpaceRef {
  id: string;
  name: string;
}

export interface ProjectDetail extends ProjectSummary {
  space: ProjectSpaceRef;
}

/** Real per-status project counts for one space (filter badges). */
export interface ProjectStatusCounts {
  all: number;
  ACTIVE: number;
  COMPLETED: number;
  ARCHIVED: number;
}

/** Mastery aggregate. `average` is null when nothing has been assessed. */
export interface MasterySummary {
  assessedConcepts: number;
  totalConcepts: number;
  average: number | null;
}

export interface AttentionConcept {
  conceptId: string;
  name: string;
  projectId: string;
  projectName: string;
  masteryScore: number;
  evidenceCount: number;
}

export interface RecommendationSummary {
  id: string;
  projectId: string;
  type: RecommendationType;
  title: string;
  description: string | null;
  priority: RecommendationPriority;
  createdAt: string;
}

export interface ActivitySummary {
  id: string;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

/** GET /api/home payload. Nulls/empties mean "no data yet" — never faked. */
export interface HomeData {
  continueLearning: ProjectSummary | null;
  recentProjects: ProjectSummary[];
  stats: {
    spaceCount: number;
    projectCount: number;
    activeProjectCount: number;
  };
  progress: MasterySummary;
  attention: AttentionConcept[];
  nextAction: RecommendationSummary | null;
}

export interface ProjectOverview {
  project: ProjectDetail;
  counts: {
    materials: number;
    concepts: number;
    conversations: number;
    quizzes: number;
    assessments: number;
  };
  mastery: MasterySummary;
  recentActivity: ActivitySummary[];
  recommendations: RecommendationSummary[];
  /** Weakest assessed concepts (mastery asc, evidence > 0). Empty = none. */
  attentionConcepts: AttentionConcept[];
  /** Growth bucket counts across the project's concepts. */
  growth: {
    improving: number;
    stable: number;
    needsAttention: number;
    insufficientData: number;
  };
  /** Top-ranked pending recommendation, null when none exists. */
  nextRecommendation: RecommendationSummary | null;
}

// ---------------------------------------------------------------------------
// Retrieval (Prompt 7 — project-scoped hybrid search)
// ---------------------------------------------------------------------------

/**
 * One ranked evidence row. Scores are documented similarities in [0, 1],
 * NOT probabilities: `semantic`/`lexical` are per-path normalized scores,
 * `combined` is the weighted blend used for ranking.
 */
export interface SearchResultItem {
  chunkId: string;
  materialId: string;
  materialName: string;
  pageId: string | null;
  pageNumber: number | null;
  content: string;
  score: number;
  retrieval: {
    semantic: number | null;
    lexical: number | null;
    combined: number;
  };
}

export interface SearchTimings {
  lexicalMs: number;
  semanticMs: number;
  rankingMs: number;
  totalMs: number;
}

export interface SearchResponse {
  query: string;
  projectId: string;
  results: SearchResultItem[];
  /** Latency breakdown for observability + the test UI. */
  meta: SearchTimings & { resultCount: number };
}

// ---------------------------------------------------------------------------
// Tutor (project-scoped RAG chat with evidence citations)
// ---------------------------------------------------------------------------

/**
 * One citation behind an assistant message. `score` is the hybrid retrieval
 * similarity in [0, 1] (not a probability); `citationLabel` is the display
 * string, e.g. "Operating Systems.pdf — Page 14".
 */
export interface TutorEvidenceItem {
  chunkId: string | null;
  materialId: string;
  materialName: string;
  pageId: string | null;
  pageNumber: number | null;
  relevanceScore: number | null;
  citationLabel: string;
}

export type TutorMessageRole = "USER" | "ASSISTANT";

export interface TutorMessageItem {
  id: string;
  role: TutorMessageRole;
  content: string;
  sequence: number;
  createdAt: string;
  /** Present on assistant messages; user messages carry none. */
  evidence: TutorEvidenceItem[];
}

export interface TutorAskResponse {
  conversationId: string;
  /** The persisted assistant message id (for evaluation + deep-links). */
  messageId: string;
  answer: string;
  evidence: TutorEvidenceItem[];
  model: string;
  latencyMs: number;
  /** True when no project evidence existed — the answer says so honestly. */
  grounded: boolean;
}

export interface ConversationSummary {
  id: string;
  projectId: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail extends ConversationSummary {
  messages: TutorMessageItem[];
  /**
   * True when the thread exceeded MAX_CONVERSATION_MESSAGES and only the
   * most recent window was returned (messageCount stays the true total).
   */
  messagesTruncated: boolean;
}

// ---------------------------------------------------------------------------
// Quizzes + assessments (adaptive generation, attempts, structured eval)
// ---------------------------------------------------------------------------

/** Difficulty uses the shared ConceptDifficulty scale (BEGINNER/INTERMEDIATE/ADVANCED). */
export type QuizDifficulty = ConceptDifficulty;
export type QuizQuestionType = QuestionType;

export type QuizMode = "ADAPTIVE" | "CONCEPT_FOCUS" | "MIXED_REVIEW";

/** Project concept for quiz focus selection. */
export interface ConceptListItem {
  id: string;
  name: string;
  description: string | null;
  difficulty: QuizDifficulty | null;
}

export interface QuizLatestAttempt {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  score: number | null;
  completedAt: string | null;
  startedAt: string;
}

/** List row: counts only, never question payloads or answer keys. */
export interface QuizSummary {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: QuizStatus;
  mode: QuizMode;
  questionCount: number;
  attemptCount: number;
  latestAttempt: QuizLatestAttempt | null;
  createdAt: string;
}

/**
 * One question as served pre-submission: options for MCQ, concept +
 * difficulty + order — but NEVER correctAnswer or explanation. Those join
 * only per answered question in attempt state.
 */
export interface SafeQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options: string[] | null;
  conceptId: string | null;
  conceptName: string | null;
  difficulty: QuizDifficulty | null;
  order: number;
}

export interface QuizDetail {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: QuizStatus;
  mode: QuizMode;
  questions: SafeQuizQuestion[];
  createdAt: string;
  /**
   * Generation counts: what was requested vs what grounded generation
   * actually produced. Equal in the normal case; when generation falls
   * short (evidence gaps), the UI shows the honest generated count.
   */
  requestedCount: number;
  generatedCount: number;
}

export type EvaluationState = "PENDING_EVALUATION" | "EVALUATED" | "EVALUATION_FAILED";

export interface AttemptQuestionState extends SafeQuizQuestion {
  answered: boolean;
  selectedOption: string | null;
  responseText: string | null;
  isCorrect: boolean | null;
  score: number | null;
  /** Present only after this question is answered (absent, not null, before). */
  correctAnswer?: string | null;
  /** Shown only after this question is answered. */
  feedback: string | null;
  /** Shown only after this question is answered. */
  explanation: string | null;
  evaluationState: EvaluationState | null;
}

export interface AttemptState {
  id: string;
  quizId: string;
  projectId: string;
  status: "ACTIVE" | "COMPLETED";
  questions: AttemptQuestionState[];
  answeredCount: number;
  questionCount: number;
  score: number | null;
  startedAt: string;
  completedAt: string | null;
}

export interface ConceptPerformance {
  conceptId: string | null;
  conceptName: string;
  answered: number;
  correct: number;
  averageScore: number | null;
}

export interface OpenEndedReview {
  questionId: string;
  prompt: string;
  answer: string;
  score: number;
  correct: boolean;
  feedback: string;
  coveredConcepts: string[];
  missingConcepts: string[];
  misconceptions: string[];
  sourceRefs: string[];
}

/**
 * Completed-attempt result. This is an ASSESSMENT RESULT (evidence for the
 * future mastery engine) — never a long-term mastery percentage.
 */
export interface QuizResult {
  attemptId: string;
  quizId: string;
  projectId: string;
  score: number;
  maxScore: number;
  correctCount: number;
  incorrectCount: number;
  openEndedCount: number;
  conceptPerformance: ConceptPerformance[];
  strengths: string[];
  weakAreas: string[];
  openEndedReviews: OpenEndedReview[];
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Mastery / Growth / Recommendations (Prompt 10 — deterministic learning loop)
// ---------------------------------------------------------------------------

/**
 * Mastery status bands derived from masteryScore (0–1). Thresholds live in
 * server config; the labels are the contract. An estimated learning signal,
 * never presented as a precise measurement.
 */
export type MasteryStatus = "NEEDS_ATTENTION" | "DEVELOPING" | "STABLE" | "STRONG";

/**
 * Growth trend from MasteryEvent history. INSUFFICIENT_DATA means fewer
 * than the configured minimum events — the UI must render an honest empty
 * state, never a fabricated trend.
 */
export type GrowthTrend = "IMPROVING" | "STABLE" | "NEEDS_ATTENTION" | "INSUFFICIENT_DATA";

export interface ConceptMasteryDetail {
  conceptId: string;
  conceptName: string;
  masteryScore: number;
  confidence: number;
  status: MasteryStatus;
  evidenceCount: number;
  lastAssessedAt: string | null;
  lastActivityAt: string | null;
  /** Score before the most recent event, null when this is the first. */
  previousScore: number | null;
  /** Most-recent delta (newScore − previousScore), null when first. */
  scoreChange: number | null;
}

export interface MasteryHistoryPoint {
  masteryEventId: string;
  previousScore: number | null;
  newScore: number;
  delta: number | null;
  sourceType: string;
  createdAt: string;
}

export interface ConceptGrowth {
  conceptId: string;
  conceptName: string;
  masteryScore: number;
  status: MasteryStatus;
  trend: GrowthTrend;
  /** |recent − older| scaled to [0, 1]; 0 when INSUFFICIENT_DATA. */
  trendStrength: number;
  /** Product signal in [0, 1] — explicitly not statistical certainty. */
  confidence: number;
  /** Factual drivers, e.g. "3 recent incorrect answers". Learner-safe. */
  reasons: string[];
  evidenceCount: number;
  lastAssessedAt: string | null;
}

/** GET /api/projects/:projectId/growth payload. All rows project-scoped. */
export interface GrowthData {
  projectId: string;
  concepts: ConceptGrowth[];
  improving: ConceptGrowth[];
  stable: ConceptGrowth[];
  needsAttention: ConceptGrowth[];
  insufficientData: ConceptGrowth[];
  /** Mean masteryScore across assessed concepts, null when none assessed. */
  averageMastery: number | null;
  assessedConcepts: number;
  totalConcepts: number;
}

export interface ConceptMistake {
  responseId: string;
  attemptId: string;
  quizId: string;
  questionPrompt: string;
  feedback: string | null;
  score: number | null;
  createdAt: string;
}

export interface ConceptAssessmentEvidence {
  assessmentId: string;
  responseId: string;
  attemptId: string;
  score: number | null;
  correct: boolean | null;
  feedback: string | null;
  createdAt: string;
}

/** GET /api/projects/:projectId/concepts/:conceptId payload. */
export interface ConceptDetailData {
  concept: ConceptListItem;
  mastery: ConceptMasteryDetail | null;
  growth: ConceptGrowth | null;
  history: MasteryHistoryPoint[];
  recentEvidence: ConceptAssessmentEvidence[];
  mistakes: ConceptMistake[];
  recommendations: RecommendationDetail[];
}

export interface RecommendationDetail {
  id: string;
  projectId: string;
  conceptId: string | null;
  conceptName: string | null;
  type: RecommendationType;
  title: string;
  description: string | null;
  /** Client-navigable target: quiz tab, materials tab, or project page. */
  action: RecommendationAction | null;
  priority: RecommendationPriority;
  status: RecommendationStatus;
  /** Factual, evidence-derived explanation. Never generic filler. */
  reason: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type RecommendationActionKind =
  "PRACTICE_CONCEPT" | "REVIEW_MATERIAL" | "OPEN_PROJECT" | "TAKE_QUIZ";

export interface RecommendationAction {
  kind: RecommendationActionKind;
  /** Concept id for PRACTICE_CONCEPT, material id for REVIEW_MATERIAL. */
  targetId: string | null;
  label: string;
}

// ---------------------------------------------------------------------------
// Analytics + Admin (Prompt 11 — all values from persisted rows, UTC)
// ---------------------------------------------------------------------------

/** One day bucket in a UTC activity series. */
export interface ActivityDayPoint {
  /** UTC midnight ISO timestamp for the bucket. */
  date: string;
  count: number;
}

export interface MasteryDistribution {
  needsAttention: number;
  developing: number;
  stable: number;
  strong: number;
  unassessed: number;
}

/** GET /api/projects/:projectId/analytics payload. */
export interface ProjectAnalytics {
  projectId: string;
  from: string;
  to: string;
  totals: {
    activity: number;
    activityDays: number;
    learningStreakDays: number;
    materials: number;
    materialsReady: number;
    materialsProcessing: number;
    materialsFailed: number;
    tutorInteractions: number;
    quizzes: number;
    quizAttempts: number;
    quizzesCompleted: number;
    assessments: number;
    averageAssessmentScore: number | null;
    conceptsTracked: number;
    conceptsAssessed: number;
    recommendationsCreated: number;
    recommendationsCompleted: number;
    recommendationsDismissed: number;
  };
  activityOverTime: ActivityDayPoint[];
  masteryDistribution: MasteryDistribution;
  masteryTrend: ActivityDayPoint[];
  recentActivity: ActivitySummary[];
}

/** Focused user-level analytics; complements (never replaces) /api/home. */
export interface HomeAnalytics {
  userId: string;
  from: string;
  to: string;
  totals: {
    spaces: number;
    projects: number;
    activeProjects: number;
    materialsReady: number;
    tutorInteractions: number;
    quizAttempts: number;
    assessmentsCompleted: number;
    averageAssessmentScore: number | null;
    conceptsNeedingAttention: number;
    conceptsImproving: number;
    recommendationsCompleted: number;
    recommendationsPending: number;
    activeDays: number;
  };
  activityOverTime: ActivityDayPoint[];
  recentActivity: ActivitySummary[];
}

/** Safe admin user row — never password hashes, tokens, or secrets. */
export interface AdminUserSummary {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  createdAt: string;
  lastActiveAt: string | null;
  counts: {
    spaces: number;
    projects: number;
    materials: number;
    quizAttempts: number;
    assessments: number;
  };
}

export interface AdminUserDetail extends AdminUserSummary {
  spaces: { id: string; name: string; projectCount: number; createdAt: string }[];
  recentActivity: ActivitySummary[];
  mastery: { assessedConcepts: number; totalConcepts: number; average: number | null };
  recommendations: { pending: number; completed: number; dismissed: number };
}

export interface AdminOverview {
  users: { total: number; recent: number; active: number };
  spaces: { total: number; projects: number };
  materials: { uploaded: number; ready: number; processing: number; failed: number };
  learning: {
    tutorInteractions: number;
    quizAttempts: number;
    assessmentsCompleted: number;
    activeDays: number;
  };
  ai: {
    calls: number;
    successful: number;
    failed: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
    averageLatencyMs: number | null;
  };
  jobs: {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    failureRate: number | null;
    averageDurationMs: number | null;
  };
}

export interface AdminActivityItem extends ActivitySummary {
  userId: string | null;
  userEmail: string | null;
  spaceId: string | null;
  projectId: string | null;
}

export interface AdminLearningAnalytics {
  from: string;
  to: string;
  quizzes: { created: number; attempts: number; completed: number; completionRate: number | null };
  accuracy: { correct: number; answered: number; rate: number | null };
  assessments: { completed: number; averageScore: number | null };
  masteryDistribution: MasteryDistribution;
  improving: number;
  needingAttention: number;
  activityOverTime: ActivityDayPoint[];
  recommendations: { created: number; completed: number; completionRate: number | null };
  repeatedMistakes: { conceptId: string; conceptName: string; incorrectCount: number }[];
}

export interface AdminAIUsageItem {
  id: string;
  userId: string | null;
  projectId: string | null;
  feature: string;
  provider: string;
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  status: string;
  createdAt: string;
}

export interface AdminAIEvaluationItem {
  id: string;
  feature: string;
  model: string;
  provider: string;
  targetType: string | null;
  targetId: string | null;
  evaluator: string | null;
  createdAt: string;
  /** Score keys present (values stay server-side for size). */
  scoreKeys: string[];
}

export interface AdminJobItem {
  id: string;
  materialId: string;
  materialName: string | null;
  projectId: string | null;
  type: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSystemHealth {
  status: "healthy" | "degraded";
  services: {
    database: { status: "healthy" | "degraded" | "skipped"; detail?: string; latencyMs?: number };
    redis: { status: "healthy" | "degraded" | "skipped"; detail?: string; latencyMs?: number };
    worker: { status: "healthy" | "degraded" | "unknown"; detail?: string };
    storage: { status: "configured" | "not-configured" | "degraded"; detail?: string };
    ai: {
      groq: { status: "configured" | "not-configured" };
      gemini: { status: "configured" | "not-configured" };
    };
  };
  version: string;
  timestamp: string;
}

export * from "./db.js";
