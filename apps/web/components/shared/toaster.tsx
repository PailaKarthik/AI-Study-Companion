"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  dismissToast,
  getToasts,
  pushToast,
  subscribeToasts,
  type ToastVariant,
} from "@/lib/toast";
import { cn } from "@/lib/utils";

const ICONS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

/** Ergonomic toast API for mutations and auth events. */
export function useToast() {
  return {
    toast: (title: string, description?: string) => pushToast({ title, description }),
    success: (title: string, description?: string) =>
      pushToast({ title, description, variant: "success" }),
    error: (title: string, description?: string) =>
      pushToast({ title, description, variant: "error" }),
    info: (title: string, description?: string) =>
      pushToast({ title, description, variant: "info" }),
    dismiss: dismissToast,
  };
}

/** Fixed bottom-right toast viewport. Mount once in the root layout. */
export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getToasts);
  const reduce = useReducedMotion();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const Icon = ICONS[toast.variant];
          return (
            <motion.div
              key={toast.id}
              role="status"
              layout={reduce ? false : true}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-4 shadow-lg",
                toast.variant === "error" && "border-destructive/40"
              )}
            >
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 h-4 w-4 shrink-0",
                  toast.variant === "error" && "text-destructive",
                  toast.variant !== "error" && "text-muted-foreground"
                )}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description ? (
                  <p className="text-sm text-muted-foreground">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                aria-label={`Dismiss: ${toast.title}`}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
