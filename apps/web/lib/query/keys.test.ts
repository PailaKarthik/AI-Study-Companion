import { describe, expect, it } from "vitest";
import { queryKeys } from "./keys";

describe("query keys", () => {
  it("exposes stable keys only for APIs that exist", () => {
    expect(queryKeys.currentUser).toEqual(["auth", "me"]);
    expect(queryKeys.apiHealth).toEqual(["admin", "health"]);
    expect(queryKeys.apiReadiness).toEqual(["admin", "ready"]);
    expect(queryKeys.home).toEqual(["home"]);
  });

  it("returns the same references on repeat access", () => {
    expect(queryKeys.currentUser).toBe(queryKeys.currentUser);
  });

  it("builds scoped keys for spaces, projects, home, and overviews", () => {
    expect(queryKeys.home).toEqual(["home"]);
    expect(queryKeys.spaces({ page: 1 })).toEqual(["spaces", { page: 1 }]);
    expect(queryKeys.space("s1")).toEqual(["spaces", "s1"]);
    expect(queryKeys.projects("s1", { q: "os" })).toEqual([
      "spaces",
      "s1",
      "projects",
      { q: "os" },
    ]);
    expect(queryKeys.project("p1")).toEqual(["projects", "p1"]);
    expect(queryKeys.projectOverview("p1")).toEqual(["projects", "p1", "overview"]);
  });

  it("covers every feature resource key (no hardcoded duplicates in hooks)", () => {
    // Guards the useProjectConcepts drift: hooks must use these, never
    // inline arrays, so invalidation always fans out.
    expect(queryKeys.conversations("p1")).toEqual(["projects", "p1", "conversations"]);
    expect(queryKeys.conversation("p1", "c1")).toEqual(["projects", "p1", "conversations", "c1"]);
    expect(queryKeys.quizzes("p1")).toEqual(["projects", "p1", "quizzes"]);
    expect(queryKeys.materials("p1")).toEqual(["projects", "p1", "materials"]);
    expect(queryKeys.concepts("p1")).toEqual(["projects", "p1", "concepts"]);
    expect(queryKeys.quiz("q1")).toEqual(["quizzes", "q1"]);
    expect(queryKeys.attempt("a1")).toEqual(["quiz-attempts", "a1"]);
    expect(queryKeys.growth("p1")).toEqual(["projects", "p1", "growth"]);
    expect(queryKeys.conceptDetail("p1", "c1")).toEqual(["projects", "p1", "concepts", "c1"]);
    expect(queryKeys.recommendations("p1")).toEqual(["projects", "p1", "recommendations"]);
    expect(queryKeys.projectAnalytics("p1", { from: "x" })).toEqual([
      "projects",
      "p1",
      "analytics",
      { from: "x" },
    ]);
    expect(queryKeys.homeAnalytics({ from: "x" })).toEqual(["home", "analytics", { from: "x" }]);
    expect(queryKeys.adminUsers({ page: 2 })).toEqual(["admin", "users", { page: 2 }]);
    expect(queryKeys.adminActivity({ eventType: "TUTOR_INTERACTION" })).toEqual([
      "admin",
      "activity",
      { eventType: "TUTOR_INTERACTION" },
    ]);
    expect(queryKeys.adminSystemHealth).toEqual(["admin", "system-health"]);
  });
});
