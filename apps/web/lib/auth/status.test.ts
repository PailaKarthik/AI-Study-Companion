import { describe, expect, it } from "vitest";
import { getAuthStatus, isAdminUser } from "./status";

const user = { id: "u1", name: "Ada", email: "ada@example.com", role: "USER" } as const;
const admin = { ...user, role: "ADMIN" } as const;

describe("getAuthStatus", () => {
  it("reports loading while the query is pending", () => {
    expect(getAuthStatus({ isPending: true, isError: false, user: undefined })).toBe("loading");
  });

  it("reports unauthenticated for a resolved null user", () => {
    expect(getAuthStatus({ isPending: false, isError: false, user: null })).toBe("unauthenticated");
  });

  it("fails closed to unauthenticated when the query errors", () => {
    expect(getAuthStatus({ isPending: false, isError: true, user: undefined })).toBe(
      "unauthenticated"
    );
  });

  it("reports authenticated for a resolved user", () => {
    expect(getAuthStatus({ isPending: false, isError: false, user })).toBe("authenticated");
  });
});

describe("isAdminUser", () => {
  it("is true only for server-verified ADMIN role", () => {
    expect(isAdminUser(admin)).toBe(true);
    expect(isAdminUser(user)).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});
