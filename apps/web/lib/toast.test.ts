import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToasts,
  dismissToast,
  getToasts,
  pushToast,
  resetToastStoreForTests,
  subscribeToasts,
} from "./toast";

afterEach(() => {
  vi.useRealTimers();
  resetToastStoreForTests();
});

describe("toast store", () => {
  it("pushes toasts with defaults and notifies subscribers", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToasts(() => seen.push(getToasts().length));
    const id = pushToast({ title: "Saved" });
    expect(id).toBe("toast-1");
    expect(getToasts()).toMatchObject([
      { id: "toast-1", title: "Saved", variant: "default", duration: 4500 },
    ]);
    expect(seen).toEqual([1]);
    unsubscribe();
    pushToast({ title: "Silent" });
    expect(seen).toEqual([1]);
  });

  it("caps visible toasts at four, dropping the oldest", () => {
    for (let i = 1; i <= 6; i += 1) pushToast({ title: `T${i}`, duration: 0 });
    const titles = getToasts().map((t) => t.title);
    expect(titles).toEqual(["T3", "T4", "T5", "T6"]);
  });

  it("dismisses toasts manually", () => {
    const id = pushToast({ title: "Bye", duration: 0 });
    dismissToast(id);
    expect(getToasts()).toEqual([]);
    expect(() => dismissToast("toast-missing")).not.toThrow();
  });

  it("auto-dismisses after the duration", () => {
    vi.useFakeTimers();
    pushToast({ title: "Ephemeral", duration: 1000 });
    expect(getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(getToasts()).toEqual([]);
  });

  it("clears all toasts", () => {
    pushToast({ title: "A", duration: 0 });
    pushToast({ title: "B", duration: 0 });
    clearToasts();
    expect(getToasts()).toEqual([]);
  });
});
