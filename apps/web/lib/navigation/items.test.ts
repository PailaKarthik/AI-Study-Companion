import { describe, expect, it } from "vitest";
import { matchNavItem, visibleNavItems } from "./items";

const user = { id: "u1", name: "Ada", email: "ada@example.com", role: "USER" } as const;
const admin = { ...user, role: "ADMIN" } as const;

describe("visibleNavItems", () => {
  it("shows home and spaces to signed-in users, admins additionally see admin", () => {
    expect(visibleNavItems(user).map((i) => i.id)).toEqual(["home", "spaces"]);
    expect(visibleNavItems(null).map((i) => i.id)).toEqual(["home", "spaces"]);
    expect(visibleNavItems(admin).map((i) => i.id)).toEqual(["home", "spaces", "admin"]);
  });

  it("hides the admin entry from non-admins and anonymous users", () => {
    expect(visibleNavItems(user).some((i) => i.id === "admin")).toBe(false);
    expect(visibleNavItems(null).some((i) => i.id === "admin")).toBe(false);
  });

  it("shows the admin entry to server-verified admins", () => {
    expect(visibleNavItems(admin).map((i) => i.id)).toContain("admin");
  });
});

describe("matchNavItem", () => {
  it("matches exact and nested paths with longest-prefix wins", () => {
    expect(matchNavItem("/")).toBe("home");
    expect(matchNavItem("/spaces")).toBe("spaces");
    expect(matchNavItem("/spaces/abc/projects/def")).toBe("spaces");
  });

  it("returns null for unknown paths", () => {
    expect(matchNavItem("/login")).toBeNull();
    expect(matchNavItem("/nope")).toBeNull();
  });
});
