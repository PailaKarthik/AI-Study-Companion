/**
 * Static schema contract tests (no database required).
 *
 * These guard the constraints the prompt explicitly demands — mastery
 * uniqueness, page/chunk idempotency keys, project-scoped uniqueness and
 * the pgvector strategy — by asserting on the committed schema + migration
 * text. Live constraint behavior is additionally verified against a real
 * database in CI when TEST_DATABASE_URL is provided (see docs/DATABASE.md);
 * without it, these tests are the offline safety net and must still pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");
const migration = readFileSync(
  join(here, "..", "prisma", "migrations", "0001_domain_foundation", "migration.sql"),
  "utf8"
);

const MODELS = [
  "User",
  "LearnerContext",
  "Space",
  "Project",
  "Material",
  "DocumentJob",
  "DocumentPage",
  "KnowledgeChunk",
  "Concept",
  "ConceptRelation",
  "Conversation",
  "Message",
  "TutorEvidence",
  "Quiz",
  "QuizQuestion",
  "QuizAttempt",
  "QuizResponse",
  "Assessment",
  "ConceptMastery",
  "MasteryEvent",
  "Recommendation",
  "ActivityEvent",
  "AIUsage",
  "AIEvaluation",
];

const ENUMS = [
  "UserRole",
  "LearnerContextType",
  "ProjectStatus",
  "MaterialStatus",
  "DocumentJobType",
  "DocumentJobStatus",
  "ConceptDifficulty",
  "ConceptRelationType",
  "MessageRole",
  "QuestionType",
  "QuizStatus",
  "MasterySourceType",
  "RecommendationType",
  "RecommendationPriority",
  "RecommendationStatus",
  "AIFeature",
  "AIProvider",
  "AIUsageStatus",
];

describe("schema models", () => {
  for (const model of MODELS) {
    it(`defines model ${model}`, () => {
      expect(schema).toContain(`model ${model} {`);
    });
  }
});

describe("schema enums", () => {
  for (const name of ENUMS) {
    it(`defines enum ${name}`, () => {
      expect(schema).toContain(`enum ${name} {`);
    });
  }

  it("covers required enum values", () => {
    for (const value of ["USER", "ADMIN"]) {
      expect(schema).toMatch(new RegExp(`enum UserRole \\{[\\s\\S]*?${value}`));
    }
    for (const value of ["UPLOADED", "QUEUED", "PROCESSING", "READY", "FAILED"]) {
      expect(schema).toMatch(new RegExp(`enum MaterialStatus \\{[\\s\\S]*?${value}`));
    }
    for (const value of ["MCQ", "OPEN_ENDED"]) {
      expect(schema).toMatch(new RegExp(`enum QuestionType \\{[\\s\\S]*?${value}`));
    }
    for (const value of ["USER", "ASSISTANT", "SYSTEM", "TOOL"]) {
      expect(schema).toMatch(new RegExp(`enum MessageRole \\{[\\s\\S]*?${value}`));
    }
  });
});

describe("uniqueness / idempotency constraints", () => {
  it("mastery is unique per user + project + concept", () => {
    expect(schema).toContain("@@unique([userId, projectId, conceptId])");
  });

  it("pages upsert per material + page (retry-safe)", () => {
    expect(schema).toContain("@@unique([materialId, pageNumber])");
  });

  it("chunks upsert per material + chunk index (re-ingestion safe)", () => {
    expect(schema).toContain("@@unique([materialId, chunkIndex])");
  });

  it("messages are ordered uniquely per conversation", () => {
    expect(schema).toContain("@@unique([conversationId, sequence])");
  });

  it("one response per attempt + question", () => {
    expect(schema).toContain("@@unique([attemptId, questionId])");
  });

  it("quiz submissions carry a unique idempotency key", () => {
    expect(schema).toMatch(/idempotencyKey\s+String\?\s+@unique/);
  });

  it("materials are deduplicated by storage key", () => {
    expect(schema).toMatch(/storageKey\s+String\s+@unique/);
  });

  it("blob metadata lives in PostgreSQL, bytes in the bucket (no bytea, no R2)", () => {
    expect(schema).toContain("model MaterialBlob {");
    // No binary column type anywhere: bytes belong in Neon Object Storage.
    // (`sizeBytes` counters and prose mentions of "bytes" are fine.)
    expect(schema).not.toMatch(/^\s*\w+\s+Bytes(\[\])?\s*$/m);
    expect(schema).not.toMatch(/data\s+Bytes/);
    expect(schema).not.toMatch(/base64/i);
    // Image metadata (dimensions) is stored for selective future use.
    expect(schema).toMatch(/width\s+Int\?/);
    expect(schema).toMatch(/height\s+Int\?/);
    expect(schema).toContain('@@map("material_blobs")');
    expect(schema).not.toMatch(/storageUrl/);
    expect(schema).not.toMatch(/[Rr]2/);
  });

  it("queue jobs correlate via a unique BullMQ job id", () => {
    expect(schema).toMatch(/jobId\s+String\?\s+@unique/);
  });

  it("concepts do not duplicate within a project", () => {
    expect(schema).toContain("@@unique([projectId, name])");
  });
});

describe("project isolation shape", () => {
  it("project-owned models carry a projectId", () => {
    for (const model of [
      "Material",
      "DocumentPage",
      "KnowledgeChunk",
      "Concept",
      "Conversation",
      "Message",
      "Quiz",
      "QuizAttempt",
      "ConceptMastery",
      "Recommendation",
    ]) {
      const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
      expect(block?.[1]).toMatch(/projectId\s+String/);
    }
  });

  it("projects denormalize the owner for efficient authorization", () => {
    expect(schema).toMatch(/model Project \{[\s\S]*?ownerId\s+String/);
  });
});

describe("pgvector strategy", () => {
  it("uses a real vector column, not a JSON fake", () => {
    expect(schema).toContain('Unsupported("vector(768)")');
    const chunkBlock = schema.match(/model KnowledgeChunk \{([\s\S]*?)\n\}/)?.[1];
    expect(chunkBlock).not.toMatch(/embedding\s+Json/);
  });

  it("migration enables the extension and builds an HNSW index", () => {
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS "vector"');
    expect(migration).toContain("knowledge_chunks_embedding_hnsw_idx");
    expect(migration).toContain("vector_cosine_ops");
  });

  it("migration covers every model table", () => {
    for (const table of [
      "users",
      "learner_contexts",
      "spaces",
      "projects",
      "materials",
      "document_jobs",
      "document_pages",
      "knowledge_chunks",
      "concepts",
      "concept_relations",
      "conversations",
      "messages",
      "tutor_evidence",
      "quizzes",
      "quiz_questions",
      "quiz_attempts",
      "quiz_responses",
      "assessments",
      "concept_mastery",
      "mastery_events",
      "recommendations",
      "activity_events",
      "ai_usage",
      "ai_evaluations",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
  });
});
