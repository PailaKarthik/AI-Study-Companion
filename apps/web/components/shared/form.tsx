"use client";

import type { InputHTMLAttributes, ReactNode } from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Standard form field: label + input + validation error + hint.
 * All auth and future feature forms compose this — no bespoke field markup.
 */
export function Field({
  id,
  label,
  error,
  hint,
  registration,
  inputProps,
  className,
}: {
  id: string;
  label: string;
  error?: FieldError | undefined;
  hint?: ReactNode;
  registration: UseFormRegisterReturn;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  className?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...registration}
        {...inputProps}
      />
      {error?.message ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
      {hint && !error?.message ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
