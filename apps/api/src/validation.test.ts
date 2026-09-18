import { describe, expect, it } from "vitest";
import {
  conceptIdParamSchema,
  createProjectSchema,
  createQuizSchema,
  createSpaceSchema,
  emailSchema,
  idParamSchema,
  loginSchema,
  normalizeEmail,
  paginationSchema,
  passwordSchema,
  projectConceptParamsSchema,
  projectIdParamSchema,
  projectListQuerySchema,
  projectConversationParamsSchema,
  recommendationIdParamSchema,
  registerSchema,
  searchQuerySchema,
  spaceIdParamSchema,
  spaceListQuerySchema,
  startAttemptSchema,
  submitResponseSchema,
  tutorAskSchema,
  tutorMessageSchema,
  updateProjectSchema,
  updateSpaceSchema,
  uuidSchema,
} from "@ai-study-companion/validation";

/** Pure validation tests — no database required, always run. */
describe("input validation", () => {
  it("normalizes email (trim + lowercase)", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(emailSchema.parse("  Alice@Example.COM ")).toBe("alice@example.com");
  });

  it("rejects malformed emails", () => {
    for (const bad of ["nope", "a@b", "@x.com", "a".repeat(250) + "@x.com", ""]) {
      expect(emailSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("enforces the password policy", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("long-enough-password-1").success).toBe(true);
    expect(passwordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });

  it("register requires name/email/password within limits", () => {
    expect(
      registerSchema.safeParse({ name: "A", email: "a@b.co", password: "password-123" }).success
    ).toBe(true);
    expect(
      registerSchema.safeParse({ name: "", email: "a@b.co", password: "password-123" }).success
    ).toBe(false);
    expect(
      registerSchema.safeParse({ name: "A", email: "a@b.co", password: "short" }).success
    ).toBe(false);
    expect(registerSchema.safeParse({ email: "a@b.co", password: "password-123" }).success).toBe(
      false
    );
  });

  it("login requires non-empty credentials", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "bad", password: "x" }).success).toBe(false);
  });

  it("uuid params reject malformed ids", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(uuidSchema.safeParse("00000000-0000-4000-8000-000000000000").success).toBe(true);
    expect(idParamSchema("projectId").safeParse({ projectId: "nope" }).success).toBe(false);
  });

  it("pagination rejects out-of-range input", () => {
    expect(paginationSchema.safeParse({ pageSize: 10000 }).success).toBe(false);
    expect(paginationSchema.safeParse({ page: 0 }).success).toBe(false);
    expect(paginationSchema.parse({ page: 2, pageSize: 20 })).toMatchObject({
      page: 2,
      pageSize: 20,
    });
  });

  it("future message/query ceilings reject empty and oversized input", () => {
    expect(tutorMessageSchema.safeParse("").success).toBe(false);
    expect(tutorMessageSchema.safeParse("x".repeat(8001)).success).toBe(false);
    expect(searchQuerySchema.safeParse("x".repeat(501)).success).toBe(false);
  });

  it("tutor ask body requires a message and rejects generation overrides", () => {
    expect(tutorAskSchema.safeParse({ message: "What is paging?" }).success).toBe(true);
    expect(
      tutorAskSchema.safeParse({
        message: "What is paging?",
        conversationId: "00000000-0000-4000-8000-000000000000",
      }).success
    ).toBe(true);
    expect(tutorAskSchema.safeParse({ message: "" }).success).toBe(false);
    expect(tutorAskSchema.safeParse({ message: "x".repeat(8001) }).success).toBe(false);
    expect(tutorAskSchema.safeParse({ message: "ok", conversationId: "nope" }).success).toBe(false);
    // Model/temperature come from server config — never the client.
    expect(tutorAskSchema.safeParse({ message: "ok", temperature: 0.9 }).success).toBe(false);
    expect(tutorAskSchema.safeParse({ message: "ok", model: "evil" }).success).toBe(false);
    expect(tutorAskSchema.safeParse({}).success).toBe(false);
  });

  it("nested conversation params require both uuids", () => {
    const ids = {
      projectId: "00000000-0000-4000-8000-000000000000",
      conversationId: "11111111-1111-4111-8111-111111111111",
    };
    expect(projectConversationParamsSchema.safeParse(ids).success).toBe(true);
    expect(projectConversationParamsSchema.safeParse({ ...ids, projectId: "nope" }).success).toBe(
      false
    );
    expect(projectConversationParamsSchema.safeParse({ projectId: ids.projectId }).success).toBe(
      false
    );
  });

  it("space schemas trim, bound, and reject unknown/system fields", () => {
    expect(createSpaceSchema.parse({ name: "  CS  " })).toMatchObject({ name: "CS" });
    expect(createSpaceSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ name: "Ok", ownerId: "evil" }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ name: "Ok", color: "red" }).success).toBe(false);
    expect(createSpaceSchema.safeParse({ name: "Ok", color: "#4F46E5" }).success).toBe(true);

    expect(updateSpaceSchema.safeParse({ name: "New" }).success).toBe(true);
    expect(updateSpaceSchema.safeParse({}).success).toBe(false);
    expect(updateSpaceSchema.safeParse({ ownerId: "evil" }).success).toBe(false);
    expect(updateSpaceSchema.safeParse({ description: null }).success).toBe(true);
  });

  it("treats empty optional strings as absent on create", () => {
    // HTML forms submit "" for untouched inputs — must not fail min(1).
    expect(createProjectSchema.parse({ name: "OS", goal: "" })).toEqual({ name: "OS" });
    expect(createSpaceSchema.parse({ name: "CS", description: "" })).toMatchObject({ name: "CS" });
  });

  it("treats empty strings as clear-field on update", () => {
    expect(updateProjectSchema.parse({ description: "" })).toEqual({ description: null });
    expect(updateProjectSchema.parse({ goal: "" })).toEqual({ goal: null });
    expect(updateSpaceSchema.parse({ description: "" })).toEqual({ description: null });
  });

  it("project schemas bound input and freeze ownership fields", () => {
    expect(createProjectSchema.safeParse({ name: "OS", goal: "x".repeat(2001) }).success).toBe(
      false
    );
    expect(
      createProjectSchema.safeParse({ name: "OS", userId: "evil", spaceId: "evil" }).success
    ).toBe(false);
    expect(updateProjectSchema.safeParse({ status: "ARCHIVED" }).success).toBe(true);
    expect(updateProjectSchema.safeParse({ status: "NOPE" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ ownerId: "x" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({ createdAt: "2020-01-01" }).success).toBe(false);
    expect(updateProjectSchema.safeParse({}).success).toBe(false);
  });

  it("list queries paginate and bound search terms", () => {
    expect(spaceListQuerySchema.parse({ page: "2", q: "  os " })).toMatchObject({
      page: 2,
      q: "os",
    });
    expect(spaceListQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(projectListQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
  });

  it("id param schemas name their route parameter", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(spaceIdParamSchema.parse({ spaceId: id })).toEqual({ spaceId: id });
    expect(projectIdParamSchema.parse({ projectId: id })).toEqual({ projectId: id });
    expect(spaceIdParamSchema.safeParse({ spaceId: "nope" }).success).toBe(false);
  });

  it("quiz creation bounds counts and focuses deliberately", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(createQuizSchema.parse({})).toMatchObject({ questionCount: 10, mode: "ADAPTIVE" });
    expect(createQuizSchema.safeParse({ questionCount: 0 }).success).toBe(false);
    expect(createQuizSchema.safeParse({ questionCount: 21 }).success).toBe(false);
    expect(createQuizSchema.safeParse({ questionCount: 2, mode: "NOPE" }).success).toBe(false);
    expect(createQuizSchema.safeParse({ questionCount: 2, model: "evil" }).success).toBe(false);
    expect(createQuizSchema.safeParse({ questionCount: 2, mode: "CONCEPT_FOCUS" }).success).toBe(
      false
    );
    expect(
      createQuizSchema.safeParse({
        questionCount: 2,
        mode: "CONCEPT_FOCUS",
        conceptIds: [id],
      }).success
    ).toBe(true);
  });

  it("response submission requires exactly one answer shape", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(submitResponseSchema.safeParse({ questionId: id, selectedOption: "A" }).success).toBe(
      true
    );
    expect(submitResponseSchema.safeParse({ questionId: id, responseText: "essay" }).success).toBe(
      true
    );
    expect(
      submitResponseSchema.safeParse({ questionId: id, selectedOption: "A", responseText: "x" })
        .success
    ).toBe(false);
    expect(submitResponseSchema.safeParse({ questionId: id }).success).toBe(false);
    expect(
      submitResponseSchema.safeParse({ questionId: "nope", selectedOption: "A" }).success
    ).toBe(false);
  });

  it("attempt start tolerates an empty body", () => {
    expect(startAttemptSchema.parse(undefined)).toEqual({});
    expect(startAttemptSchema.parse({ restart: true })).toEqual({ restart: true });
    expect(startAttemptSchema.safeParse({ restart: "yes" }).success).toBe(false);
  });

  it("mastery params validate uuid pairs", () => {
    const id = "00000000-0000-4000-8000-000000000000";
    expect(conceptIdParamSchema.parse({ conceptId: id })).toEqual({ conceptId: id });
    expect(recommendationIdParamSchema.parse({ recommendationId: id })).toEqual({
      recommendationId: id,
    });
    expect(projectConceptParamsSchema.parse({ projectId: id, conceptId: id })).toEqual({
      projectId: id,
      conceptId: id,
    });
    expect(projectConceptParamsSchema.safeParse({ projectId: id }).success).toBe(false);
    expect(projectConceptParamsSchema.safeParse({ projectId: "nope", conceptId: id }).success).toBe(
      false
    );
    expect(recommendationIdParamSchema.safeParse({ recommendationId: "nope" }).success).toBe(false);
  });
});
