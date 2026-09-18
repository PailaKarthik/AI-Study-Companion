"use client";

import { useEffect, useState } from "react";

/**
 * Debounce a fast-changing value (e.g. search input) so queries fire only
 * after the user pauses. No external state library needed.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
