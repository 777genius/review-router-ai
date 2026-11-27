import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPrismaClient: vi.fn((options?: unknown) => ({ options })),
}));

vi.mock("@reviewrouter/platform-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@reviewrouter/platform-db")>()),
  createPrismaClient: mocks.createPrismaClient,
}));

import { runtimeDatabaseExecutionBudget } from "@reviewrouter/platform-db";
import { getCodexEffectAuthorityPrisma, getPrisma } from "./prisma";

type PrismaGlobal = typeof globalThis & {
  reviewRouterPrisma?: unknown;
  reviewRouterCodexEffectAuthorityPrisma?: unknown;
};

const prismaGlobal = globalThis as PrismaGlobal;

afterEach(() => {
  delete prismaGlobal.reviewRouterPrisma;
  delete prismaGlobal.reviewRouterCodexEffectAuthorityPrisma;
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("web Prisma clients", () => {
  it.each(["development", "production"])(
    "reuses one runtime client in %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      const first = getPrisma();

      expect(getPrisma()).toBe(first);
      expect(mocks.createPrismaClient).toHaveBeenCalledOnce();
      expect(mocks.createPrismaClient).toHaveBeenCalledWith({
        executionBudget: runtimeDatabaseExecutionBudget,
      });
    },
  );

  it("keeps the effect-authority client separate and fails closed if its URL disappears", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://reviewrouter_web:web@db/reviewrouter",
    );
    vi.stubEnv(
      "REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL",
      "postgresql://reviewrouter_codex_effect_authority:secret@db/reviewrouter",
    );

    const runtime = getPrisma();
    const effectAuthority = getCodexEffectAuthorityPrisma();

    expect(effectAuthority).not.toBe(runtime);
    expect(getPrisma()).toBe(runtime);
    expect(getCodexEffectAuthorityPrisma()).toBe(effectAuthority);
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(2);
    expect(mocks.createPrismaClient).toHaveBeenNthCalledWith(1, {
      executionBudget: runtimeDatabaseExecutionBudget,
    });
    expect(mocks.createPrismaClient).toHaveBeenNthCalledWith(2, {
      databaseUrl:
        "postgresql://reviewrouter_codex_effect_authority:secret@db/reviewrouter",
      poolMax: 2,
      executionBudget: runtimeDatabaseExecutionBudget,
    });

    vi.stubEnv("REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL", "");
    expect(() => getCodexEffectAuthorityPrisma()).toThrow(
      "codex_oauth_database_effect_authority_unavailable",
    );
    expect(mocks.createPrismaClient).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the effect-authority URL is absent from the start", () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://reviewrouter_web:web@db/reviewrouter",
    );
    vi.stubEnv("REVIEW_ROUTER_CODEX_EFFECT_AUTHORITY_DATABASE_URL", "");

    expect(() => getCodexEffectAuthorityPrisma()).toThrow(
      "codex_oauth_database_effect_authority_unavailable",
    );
    expect(mocks.createPrismaClient).not.toHaveBeenCalled();
  });
});
