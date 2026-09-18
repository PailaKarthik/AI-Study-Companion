import { describe, expect, it } from "vitest";
import { buildPaginatedResult, MAX_PAGE_SIZE, parsePagination } from "./pagination.js";

describe("parsePagination", () => {
  it("returns defaults for empty input", () => {
    expect(parsePagination({})).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      take: 20,
    });
  });

  it("computes skip/take for later pages", () => {
    expect(parsePagination({ page: 3, pageSize: 10 })).toEqual({
      page: 3,
      pageSize: 10,
      skip: 20,
      take: 10,
    });
  });

  it("clamps oversized page sizes", () => {
    const parsed = parsePagination({ page: 1, pageSize: 10000 });
    expect(parsed.pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsed.take).toBe(MAX_PAGE_SIZE);
  });

  it("rejects non-positive and non-numeric input", () => {
    expect(parsePagination({ page: -2, pageSize: 0 })).toMatchObject({
      page: 1,
      pageSize: 20,
    });
    expect(parsePagination({ page: "abc", pageSize: "xyz" })).toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });
});

describe("buildPaginatedResult", () => {
  it("wraps items with page metadata", () => {
    expect(buildPaginatedResult([1, 2], 42, { page: 2, pageSize: 2 })).toEqual({
      items: [1, 2],
      total: 42,
      page: 2,
      pageSize: 2,
    });
  });
});
