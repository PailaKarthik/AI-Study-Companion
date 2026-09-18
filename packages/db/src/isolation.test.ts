import { describe, expect, it } from "vitest";
import {
  belongsToProject,
  canAccessProject,
  canAccessProjectInSpace,
  canAccessSpace,
  isSameProjectEvidence,
  ownedProjectWhere,
  ownedSpaceWhere,
  projectScope,
} from "./isolation.js";

const ALICE = "alice-id";
const BOB = "bob-id";

describe("space isolation", () => {
  it("owner can access their own space", () => {
    expect(canAccessSpace({ id: "s1", ownerId: ALICE }, ALICE)).toBe(true);
  });

  it("user A cannot access user B's space", () => {
    expect(canAccessSpace({ id: "s1", ownerId: BOB }, ALICE)).toBe(false);
  });

  it("missing space or user denies access", () => {
    expect(canAccessSpace(null, ALICE)).toBe(false);
    expect(canAccessSpace({ id: "s1", ownerId: ALICE }, "")).toBe(false);
    expect(canAccessSpace(undefined, ALICE)).toBe(false);
  });
});

describe("project isolation", () => {
  it("owner can access their own project", () => {
    expect(canAccessProject({ id: "p1", ownerId: ALICE, spaceId: "s1" }, ALICE)).toBe(true);
  });

  it("user A cannot access user B's project even with the project id", () => {
    // Route params alone must never grant access — ownership decides.
    expect(canAccessProject({ id: "p1", ownerId: BOB, spaceId: "s2" }, ALICE)).toBe(false);
  });

  it("full chain requires project-in-space plus ownership", () => {
    const project = { id: "p1", ownerId: ALICE, spaceId: "s1" };
    const space = { id: "s1", ownerId: ALICE };
    expect(canAccessProjectInSpace(project, space, ALICE)).toBe(true);

    // Project mounted under another user's space → deny.
    expect(canAccessProjectInSpace(project, { id: "s9", ownerId: ALICE }, ALICE)).toBe(false);
    // Space owned by someone else → deny.
    expect(canAccessProjectInSpace(project, { id: "s1", ownerId: BOB }, ALICE)).toBe(false);
    // Wrong user → deny.
    expect(canAccessProjectInSpace(project, space, BOB)).toBe(false);
  });
});

describe("project-scoped resources", () => {
  it("belongsToProject pins a row to its project", () => {
    expect(belongsToProject({ projectId: "p1" }, "p1")).toBe(true);
    expect(belongsToProject({ projectId: "p2" }, "p1")).toBe(false);
    expect(belongsToProject(null, "p1")).toBe(false);
  });

  it("evidence must stay inside the message's project", () => {
    expect(isSameProjectEvidence("p1", "p1")).toBe(true);
    expect(isSameProjectEvidence("p2", "p1")).toBe(false);
    expect(isSameProjectEvidence(null, "p1")).toBe(false);
  });

  it("where-clause builders always carry the ownership constraint", () => {
    expect(projectScope("p1")).toEqual({ projectId: "p1" });
    expect(projectScope("p1", { status: "READY" })).toEqual({
      projectId: "p1",
      status: "READY",
    });
    expect(ownedProjectWhere("p1", ALICE)).toEqual({
      id: "p1",
      ownerId: ALICE,
    });
    expect(ownedSpaceWhere("s1", ALICE)).toEqual({
      id: "s1",
      ownerId: ALICE,
    });
  });
});
