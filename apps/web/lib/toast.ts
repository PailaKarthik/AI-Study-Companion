/**
 * Minimal toast store: framework-free external store consumed through
 * `useSyncExternalStore` in `components/shared/toaster.tsx`.
 *
 * No new dependencies — a tiny emitter + auto-dismiss timers. Toasts are
 * UI feedback only (success/failure of mutations, auth events); they never
 * carry sensitive data.
 */

export type ToastVariant = "default" | "success" | "error" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay in ms. Defaults to 4500. Use 0 to require manual dismiss. */
  duration?: number;
}

export interface Toast extends Required<Omit<ToastInput, "description">> {
  id: string;
  description?: string;
  createdAt: number;
}

const MAX_TOASTS = 4;
const DEFAULT_DURATION = 4500;

type Listener = () => void;

let counter = 0;
let toasts: Toast[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

export function pushToast(input: ToastInput): string {
  counter += 1;
  const id = `toast-${counter}`;
  const toast: Toast = {
    id,
    title: input.title,
    description: input.description,
    variant: input.variant ?? "default",
    duration: input.duration ?? DEFAULT_DURATION,
    createdAt: Date.now(),
  };
  toasts = [...toasts, toast].slice(-MAX_TOASTS);
  if (toast.duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), toast.duration)
    );
  }
  emit();
  return id;
}

export function dismissToast(id: string): void {
  clearTimer(id);
  if (toasts.some((t) => t.id === id)) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }
}

export function clearToasts(): void {
  for (const id of timers.keys()) clearTimer(id);
  if (toasts.length > 0) {
    toasts = [];
    emit();
  }
}

export function getToasts(): Toast[] {
  return toasts;
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only escape hatch: resets ids and state between tests. */
export function resetToastStoreForTests(): void {
  clearToasts();
  counter = 0;
}
