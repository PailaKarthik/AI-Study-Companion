/**
 * Stable analytics range builders. Timestamps are truncated to the hour so
 * query keys stay stable across remounts (ms-precision `new Date()` per
 * render would make every mount a cache miss and refetch). Hour
 * granularity is well inside the server's day-bucket accuracy.
 */
export function hourTruncatedFrom(days: number): { from: string } {
  const from = new Date(Date.now() - days * 86_400_000);
  // UTC truncation (not local): the server buckets by UTC day, and local
  // zones with non-hour offsets (e.g. +5:30) would otherwise leave a
  // stray :30 in the key.
  from.setUTCMinutes(0, 0, 0);
  return { from: from.toISOString() };
}
