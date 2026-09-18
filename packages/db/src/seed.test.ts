/**
 * Seed idempotency tests (no database required).
 *
 * `runSeed` is exercised twice against an in-memory Prisma-shaped mock:
 * the second run must create zero rows. This proves the findUnique+create
 * (upsert-style) logic keeps re-runs duplicate-free before ever touching
 * a real database.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildSeedPlan, runSeed, seedIds } from "./seed.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  [key: string]: unknown;
}

function makeDelegate(store: Map<string, Row>, uniqueKey?: string) {
  return {
    async findUnique(args: { where: { id: string } }) {
      return store.get(args.where.id) ?? null;
    },
    async create(args: { data: Row }) {
      if (store.has(args.data.id)) {
        throw new Error(`duplicate id ${args.data.id}`);
      }
      if (uniqueKey) {
        for (const row of store.values()) {
          if (row[uniqueKey] === args.data[uniqueKey]) {
            throw new Error(`duplicate ${uniqueKey}`);
          }
        }
      }
      store.set(args.data.id, args.data);
      return args.data;
    },
    async upsert(args: { where: { email: string }; create: Row; update: Row }) {
      for (const row of store.values()) {
        if (row.email === args.where.email) {
          store.set(row.id, { ...row, ...args.update });
          return row;
        }
      }
      store.set(args.create.id, args.create);
      return args.create;
    },
  };
}

function makeMockDb() {
  const stores = {
    user: new Map<string, Row>(),
    space: new Map<string, Row>(),
    project: new Map<string, Row>(),
    concept: new Map<string, Row>(),
    material: new Map<string, Row>(),
    documentPage: new Map<string, Row>(),
    learnerContext: new Map<string, Row>(),
    conceptMastery: new Map<string, Row>(),
    masteryEvent: new Map<string, Row>(),
    activityEvent: new Map<string, Row>(),
    recommendation: new Map<string, Row>(),
  };
  return {
    user: makeDelegate(stores.user, "email"),
    space: makeDelegate(stores.space),
    project: makeDelegate(stores.project),
    concept: makeDelegate(stores.concept),
    material: makeDelegate(stores.material),
    documentPage: makeDelegate(stores.documentPage),
    learnerContext: makeDelegate(stores.learnerContext),
    conceptMastery: makeDelegate(stores.conceptMastery),
    masteryEvent: makeDelegate(stores.masteryEvent),
    activityEvent: makeDelegate(stores.activityEvent),
    recommendation: makeDelegate(stores.recommendation),
    __stores: stores,
  };
}

describe("seed plan", () => {
  it("describes the expected demo dataset", () => {
    expect(buildSeedPlan()).toEqual({
      users: 1,
      spaces: 2,
      projects: 3,
      concepts: 6,
      materials: 2,
      documentPages: 2,
      learnerContexts: 2,
      masteryRecords: 2,
      masteryEvents: 1,
      activityEvents: 3,
      recommendations: 2,
    });
  });

  it("uses deterministic, unique, valid UUIDs", () => {
    const ids = seedIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID_RE);
    }
  });
});

describe("seed idempotency (mock db)", () => {
  it("second run creates zero rows and never duplicates", async () => {
    const mock = makeMockDb();
    const db = mock as unknown as PrismaClient;

    const first = await runSeed(db);
    const firstTotal = Object.values(first).reduce((n, c) => n + c, 0);
    expect(firstTotal).toBeGreaterThan(0);

    const second = await runSeed(db);
    const secondTotal = Object.values(second).reduce((n, c) => n + c, 0);
    expect(secondTotal).toBe(0);

    // Store sizes match the plan (1 user upserted outside the counter).
    expect(mock.__stores.space.size).toBe(2);
    expect(mock.__stores.project.size).toBe(3);
    expect(mock.__stores.concept.size).toBe(6);
    expect(mock.__stores.material.size).toBe(2);
    expect(mock.__stores.recommendation.size).toBe(2);
    expect(mock.__stores.user.size).toBe(1);
  });

  it("never seeds AI conversations or quiz attempts", async () => {
    const mock = makeMockDb();
    await runSeed(mock as unknown as PrismaClient);
    const allRows = Object.values(mock.__stores).flatMap((s) => [...s.values()]);
    for (const row of allRows) {
      expect(String(row.id)).not.toMatch(/message|attempt|assessment/i);
    }
    // No conversation/quiz delegates exist on the mock — runSeed must not
    // touch them (it would throw on undefined). Reaching here proves it.
  });
});
