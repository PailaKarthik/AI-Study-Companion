/**
 * Project-isolation helpers for the service layer.
 *
 * Enforcement rule (see docs/DATABASE.md):
 *   authenticated user → owns Space → owns Project → may access resources.
 *
 * These helpers are intentionally pure (no Prisma import, no I/O) so they
 * are unit-testable without a database. Services fetch the Space/Project
 * row first, then gate every downstream query with these checks plus a
 * `projectId` where-clause — never trust a bare `WHERE id = projectId`
 * from route params.
 */

export interface OwnedSpace {
  id: string;
  ownerId: string;
}

export interface OwnedProject {
  id: string;
  ownerId: string;
  spaceId: string;
}

export interface ProjectScoped {
  projectId: string;
}

/** True when `userId` owns the space. */
export function canAccessSpace(space: OwnedSpace | null | undefined, userId: string): boolean {
  if (!space || !userId) return false;
  return space.ownerId === userId;
}

/** True when `userId` owns the project (direct owner check). */
export function canAccessProject(
  project: OwnedProject | null | undefined,
  userId: string
): boolean {
  if (!project || !userId) return false;
  return project.ownerId === userId;
}

/**
 * Full chain check: the project must belong to the space AND the user must
 * own the project. Services should load project (with spaceId) and verify.
 */
export function canAccessProjectInSpace(
  project: OwnedProject | null | undefined,
  space: OwnedSpace | null | undefined,
  userId: string
): boolean {
  if (!project || !space || !userId) return false;
  return project.spaceId === space.id && project.ownerId === userId && space.ownerId === userId;
}

/** True when a project-scoped row belongs to the expected project. */
export function belongsToProject(
  resource: ProjectScoped | null | undefined,
  projectId: string
): boolean {
  if (!resource || !projectId) return false;
  return resource.projectId === projectId;
}

/**
 * Guard for TutorEvidence and similar cross-linked rows: evidence must
 * never reference a chunk/material/page from another project.
 */
export function isSameProjectEvidence(
  evidenceProjectId: string | null | undefined,
  messageProjectId: string | null | undefined
): boolean {
  if (!evidenceProjectId || !messageProjectId) return false;
  return evidenceProjectId === messageProjectId;
}

/**
 * Prisma `where` fragment constraining a query to one project.
 * Spread into every project-scoped repository query.
 *
 * Example: `prisma.material.findMany({ where: { ...projectScope(id), status } })`
 */
export function projectScope<T extends object>(
  projectId: string,
  extra: T = {} as T
): { projectId: string } & T {
  return { projectId, ...extra };
}

/** Prisma `where` fragment for "project owned by user" lookups. */
export function ownedProjectWhere(projectId: string, ownerId: string) {
  return { id: projectId, ownerId };
}

/** Prisma `where` fragment for "space owned by user" lookups. */
export function ownedSpaceWhere(spaceId: string, ownerId: string) {
  return { id: spaceId, ownerId };
}
