import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "./client";
import { fetchCurrentUser, loginRequest } from "../../features/auth/api";

function mockFetchOnce(status: number, body: unknown) {
  const headers = new Headers({ "x-request-id": "test-req" });
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => body,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => res)
  );
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Cookie-auth contract: the browser never handles tokens — requests carry
 * credentials:include so the httpOnly session cookie flows, and 401 on /me
 * means "anonymous" rather than an exception.
 */
describe("cookie auth client contract", () => {
  it("posts credentials with cookies included (no localStorage tokens)", async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      data: { id: "u1", name: "A", email: "a@b.co", role: "USER" },
      requestId: "test-req",
    });
    const user = await loginRequest({ email: "a@b.co", password: "password-123" });
    expect(user.email).toBe("a@b.co");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/auth\/login$/);
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(init.body).toBe(JSON.stringify({ email: "a@b.co", password: "password-123" }));
  });

  it("maps 401 on /me to anonymous (null)", async () => {
    mockFetchOnce(401, {
      success: false,
      error: { code: "UNAUTHENTICATED", message: "Authentication required" },
      requestId: "test-req",
    });
    await expect(fetchCurrentUser()).resolves.toBeNull();
  });

  it("rethrows non-401 /me failures", async () => {
    mockFetchOnce(500, {
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Down" },
      requestId: "test-req",
    });
    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 500 });
  });

  it("never reads tokens from storage", async () => {
    mockFetchOnce(200, { success: true, data: null, requestId: "test-req" });
    const getItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem });
    await apiRequest("/api/auth/me", { method: "GET" });
    expect(getItem).not.toHaveBeenCalled();
  });
});
