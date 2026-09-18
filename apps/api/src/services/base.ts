/**
 * Service layer placeholder.
 *
 * Business logic lives here, called by controllers.
 * Services call repositories (Prisma) — never the reverse.
 * Feature services (spaces, projects, …) will be added in later prompts.
 */

export interface ServiceContext {
  requestId: string;
}

export function createServiceContext(requestId: string): ServiceContext {
  return { requestId };
}
