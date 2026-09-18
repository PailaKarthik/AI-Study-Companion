/**
 * Real auth feature module (Prompt 3): cookie-session integration with the
 * Express API. No mocks, no localStorage tokens — the httpOnly session
 * cookie is the only credential and the browser never sees its value.
 */
export * from "./api";
export * from "./hooks";
export { RequireAdmin, RequireAuth } from "./guard";
