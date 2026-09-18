"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CurrentUser } from "@ai-study-companion/shared";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";

/**
 * Mobile drawer navigation. Same nav config as desktop — one system, two
 * presentations. Escape closes, body scroll locks, focus moves to the close
 * button on open.
 */
export function MobileNav({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: CurrentUser | null | undefined;
}) {
  const reduce = useReducedMotion();
  // Return focus to the trigger when the drawer closes — otherwise
  // keyboard users are dropped at <body> with no sense of place.
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      triggerRef.current?.focus({ preventScroll: true });
      triggerRef.current = null;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: "easeOut" }}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-6 bg-background p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  AI
                </span>
                <span className="text-base font-semibold tracking-tight">Study Companion</span>
              </span>
              <button
                type="button"
                onClick={onClose}
                autoFocus
                aria-label="Close navigation"
                className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <SidebarNav user={user} onNavigate={onClose} />
            <p className="mt-auto text-xs text-muted-foreground">
              Signed in as {user?.email ?? "…"}
            </p>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
