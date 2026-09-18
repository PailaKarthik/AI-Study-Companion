/**
 * Web-app shared TypeScript types.
 * Feature types (spaces, projects, …) arrive with the API contracts in later prompts.
 */

export interface RouteParams {
  spaceId: string;
  projectId?: string;
}
