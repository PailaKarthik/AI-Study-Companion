/**
 * Spaces feature: API surface, TanStack Query hooks, and UI.
 * Real data only — pages render loading skeletons and empty states,
 * never fabricated spaces.
 */
export * from "./api";
export * from "./hooks";
export { SpaceCard } from "./components/SpaceCard";
export { CreateSpaceDialog } from "./components/CreateSpaceDialog";
export { EditSpaceDialog } from "./components/EditSpaceDialog";
export { DeleteSpaceDialog } from "./components/DeleteSpaceDialog";
