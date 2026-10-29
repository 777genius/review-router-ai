import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  PrismaProviderAccountRepository,
  type BindingSelection,
} from "@reviewrouter/features-provider-accounts";
import type { PrismaClient } from "@prisma/client";
import Fastify from "fastify";
import {
  createDashboardGatewayProbeAccess,
  registerDashboardGatewayProbeAccessRoute,
} from "./dashboard-gateway-probe-access";
import {
  signGatewayProbeAccess,
  gatewayProbeAccessPath,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
const usage = vi.hoisted(() => ({ diagnostic: vi.fn(async () => {}) }));
vi.mock("./provider-usage-gateway-recorder", () => ({
  createGatewayUsageRecorder: () => usage,
}));
const secret = "synthetic-probe-purpose-secret-123456";
const request = () => ({
  userId: "test-user",
  workspaceId: "test-workspace",
  bindingId: "test-binding",
  model: "test-model",
  nonce: "3900013a-6276-4606-9a46-ce40b595242c",
  deadline: new Date(Date.now() + 60000).toISOString(),
});
describe("private dashboard probe issuer", () => {
  it("rejects forged, changed, expired, over-budget and extra-field requests before DB or Gateway access", async () => {
    const db = vi.fn();
    const get = vi.fn();
    const runAccess = vi.fn();
    const issuer = createDashboardGatewayProbeAccess({
      prisma: { workspace: { findUnique: db } } as unknown as PrismaClient,
      secret,
      profiles: [],
      control: { get, runAccess },
      executionOrigin: "http://localhost:1234",
      env: {},
    });
    const original = request();
    const signature = signGatewayProbeAccess(original, secret);
    const expired = {
      ...original,
      deadline: new Date(Date.now() - 1).toISOString(),
    };
    const over = {
      ...original,
      deadline: new Date(Date.now() + 100000).toISOString(),
    };
    for (const [body, proof] of [
      [original, "0".repeat(64)],
      [{ ...original, userId: "foreign-user" }, signature],
      [expired, signGatewayProbeAccess(expired, secret)],
      [over, signGatewayProbeAccess(over, secret)],
      [{ ...original, accountRef: "caller-account" }, signature],
    ]) {
      expect((await issuer(body, proof)).status).toBe(403);
    }
    expect(db).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(runAccess).not.toHaveBeenCalled();
  });
  it("fails closed when the issuer is unconfigured and bounds HTTP request size", async () => {
    const app = Fastify();
    await registerDashboardGatewayProbeAccessRoute(app, null);
    try {
      const denied = await app.inject({
        method: "POST",
        url: gatewayProbeAccessPath,
        payload: request(),
      });
      expect(denied.statusCode).toBe(503);
      expect(denied.headers["cache-control"]).toBe("private, no-store");
      const oversized = await app.inject({
        method: "POST",
        url: gatewayProbeAccessPath,
        payload: { text: "x".repeat(5000) },
      });
      expect(oversized.statusCode).toBe(413);
    } finally {
      await app.close();
    }
  });
});

afterEach(() => vi.restoreAllMocks());

function authorizedProbeFixture(
  profileId: string,
  env: Readonly<Record<string, string | undefined>> = {},
) {
  let available = true;
  let foreign = false;
  let revokeDuringGet = false;
  vi.spyOn(
    PrismaProviderAccountRepository.prototype,
    "findBinding",
  ).mockImplementation(
    async () =>
      ({
        binding: {
          id: "test-binding",
          workspaceId: "test-workspace",
          connectionId: "connection-private",
          state: "active",
          revision: 1,
          policyRevision: 1,
          pendingFence: null,
          fenceAck: null,
        },
        connection: {
          id: "connection-private",
          owner: { kind: "workspace", workspaceId: "test-workspace" },
          gatewayAccountRef: "account-private",
          profileRef: profileId,
          gatewayOperationRef: null,
          displayName: "Fixture",
          state: "active",
          metadataRevision: 1,
        },
      }) satisfies BindingSelection,
  );
  const ownerRef = `rrw_${createHash("sha256").update("rr-workspace-owner-v1\0test-workspace").digest("hex")}`;
  const get = vi.fn<ConsumerControlClient["get"]>(async () => {
    if (revokeDuringGet) available = false;
    return {
      accountRef: "account-private",
      ownerRef: foreign ? "foreign-owner" : ownerRef,
      profileId,
      displayName: "Fixture",
      state: "active",
      metadataRevision: 1,
      authorizationEpoch: 7,
    };
  });
  const runAccess = vi.fn<ConsumerControlClient["runAccess"]>(
    async (intent) => ({
      bearer: "local-execution-token",
      operation: {
        operationRef: intent.operationId,
        state: "applied",
        result: {
          kind: "execution",
          executionRef: "execution-private",
          accountRef: intent.accountRefs[0]!,
          authorizationEpoch: 7,
          deadline: intent.deadline,
          state: "active",
        },
      },
      admission: c.admission.parse({
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        accountRef: intent.accountRefs[0],
        authorizationEpoch: 7,
        subjectRef: intent.subjectRef,
        policyRevision: intent.policyRevision,
        bindingRevision: intent.bindingRevision,
        profileId: intent.profileId,
        limits: intent.limits,
        expiresAt: intent.deadline,
      }),
    }),
  );
  const issuer = createDashboardGatewayProbeAccess({
    prisma: {
      workspace: {
        findUnique: async () =>
          available
            ? {
                deletionState: "active",
                personalOwnerUserId: null,
                members: [{ role: "member" }],
              }
            : null,
      },
      $queryRaw: async () => [
        { count: 1, limit: 5, windowEndsAt: new Date(Date.now() + 60000) },
      ],
    } as unknown as PrismaClient,
    secret,
    profiles: [
      {
        profileId,
        protocol: "openai-responses",
        modelIds: ["frozen-anchor"],
        authKinds: ["oauth"],
      },
    ],
    control: { get, runAccess },
    executionOrigin: "http://localhost:1234",
    env,
  });
  return {
    issuer,
    get,
    runAccess,
    foreignOwner: () => {
      foreign = true;
    },
    revoke: () => {
      revokeDuringGet = true;
    },
  };
}

// The actual model is enforced by Gateway/native Responses admission. This
// issuer still must authenticate/fence the exact account before minting its
// fixed, single-request execution capability.
it.each([
  ["openai-codex-oauth-responses-v1", true],
  ["fixed-profile", false],
  ["grok-subscription-responses-oauth-v1", false],
] as const)(
  "diagnostic unseen model follows only the dynamic Codex path: %s",
  async (profileId, dynamic) => {
    const f = authorizedProbeFixture(profileId, {});
    const body = {
      ...request(),
      model: "authorized-account-model-not-in-anchor",
    };
    const result = await f.issuer(body, signGatewayProbeAccess(body, secret));
    expect(result.status).toBe(dynamic ? 200 : 403);
    expect(f.runAccess).toHaveBeenCalledTimes(dynamic ? 1 : 0);
    if (dynamic)
      expect(f.runAccess.mock.calls[0]?.[0]).toMatchObject({
        accountRefs: ["account-private"],
        profileId,
        limits: { requests: 1, concurrency: 1 },
      });
  },
);

it.each(["foreignOwner", "revoke"] as const)(
  "diagnostic dynamic model cannot bypass account authority: %s",
  async (change) => {
    const f = authorizedProbeFixture("openai-codex-oauth-responses-v1", {});
    f[change]();
    const body = {
      ...request(),
      model: "authorized-account-model-not-in-anchor",
    };
    expect(
      (await f.issuer(body, signGatewayProbeAccess(body, secret))).status,
    ).toBe(403);
    expect(f.runAccess).not.toHaveBeenCalled();
  },
);
