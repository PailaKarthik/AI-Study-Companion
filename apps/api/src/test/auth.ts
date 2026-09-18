import request from "supertest";
import type { Express } from "express";

const PASSWORD = "test-password-123";

/** Register a user on the REAL app; return the raw session cookie. */
export async function registerCookie(app: Express, email: string, name?: string): Promise<string> {
  const agent = request.agent(app);
  await agent
    .post("/api/auth/register")
    .send({ name: name ?? email, email, password: PASSWORD })
    .expect(201);
  const login = await agent.post("/api/auth/login").send({ email, password: PASSWORD }).expect(200);
  const setCookies = login.headers["set-cookie"] as unknown as string[] | undefined;
  return (setCookies ?? []).map((c) => c.split(";")[0]).join("; ");
}

/** POST helper that sends JSON with a session cookie. */
export function authedPost(
  app: Express,
  path: string,
  cookie: string,
  body: Record<string, unknown>
) {
  return request(app).post(path).set("Cookie", cookie).send(body);
}

/** GET helper with a session cookie. */
export function authedGet(app: Express, path: string, cookie: string) {
  return request(app).get(path).set("Cookie", cookie);
}
