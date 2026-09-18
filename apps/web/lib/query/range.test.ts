import { describe, expect, it } from "vitest";
import { hourTruncatedFrom } from "./range";

describe("hourTruncatedFrom", () => {
  it("truncates minutes/seconds/ms for stable query keys", () => {
    const { from } = hourTruncatedFrom(30);
    expect(from.endsWith(":00:00.000Z")).toBe(true);
  });

  it("lands the requested number of days back, within the hour", () => {
    const before = Date.now();
    const { from } = hourTruncatedFrom(7);
    const after = Date.now();
    const ms = new Date(from).getTime();
    expect(before - ms).toBeGreaterThanOrEqual(7 * 86_400_000 - 3_600_000);
    expect(after - ms).toBeLessThanOrEqual(7 * 86_400_000 + 3_600_000);
  });

  it("is stable within the same hour (remount-safe)", () => {
    // Two calls in the same hour must produce the identical key — the
    // whole point of truncation (no refetch-on-remount storms).
    expect(hourTruncatedFrom(30)).toEqual(hourTruncatedFrom(30));
  });
});
