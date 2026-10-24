import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  createCapturedReviewSkills,
  canonicalReviewSkillsJson,
} from "@reviewrouter/shared/review-skills-contract";
import {
  canonicalJson,
  ReviewRunAuthorizationTokenResolutionStatus,
} from "@reviewrouter/features-review-run-control";
import { createReviewRunControlTestKit } from "../../../packages/features/review-run-control/src/testing/review-run-control-test-kit";
import { provisionV2AuthorizationContext } from "../../../packages/features/review-run-control/src/tests/fixtures";
import {
  createReviewRunSkillsReader,
  registerReviewRunSkillsRoute,
  type ReviewRunSkillsReader,
} from "./review-run-skills";

async function fixture() {
  const kit = createReviewRunControlTestKit();
  const context = await provisionV2AuthorizationContext(kit);
  const first = await kit.control.authorizations.authorizeReviewRun(
    context.authorizeInput,
  );
  if (!("authorization" in first))
    throw new Error("authorization_fixture_failed");
  const capture = createCapturedReviewSkills({
    baseSha: first.authorization.baseSha,
    webSkills: [
      {
        skillId: "skill-one",
        revisionId: "revision-one",
        sourceWorkspaceId: "source-one",
        name: "Security",
        description: "Check inputs",
        instructions: "Require input validation.",
        includePaths: ["**"],
        excludePaths: [],
      },
    ],
    gitSources: [],
  });
  const authorization = {
    ...first.authorization,
    skillsSnapshotCanonicalJson: canonicalReviewSkillsJson(capture),
    runtimeSnapshotCanonicalJson: canonicalJson({
      snapshotVersion: 3,
      configurationSource: "workspace",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: null,
      effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
      agent: {
        profileRef: "ocr-skills-fixture",
        agentKind: "ocr",
        binarySha256: "a".repeat(64),
        packageVersion: "1.13.1-rr.4",
        modelTransports: ["account_gateway"],
        contextGateway: false,
        cancellation: true,
        reviewSkillsVersion: 1,
      },
      agentProfileDigest: "b".repeat(64),
      producer: {
        producerReleaseId: first.authorization.producerReleaseId,
        actionCommitSha: "a".repeat(40),
        runtimeCommitSha: "b".repeat(40),
      },
      configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
      deadline: first.authorization.maxExpiresAt.toISOString(),
      gateway: null,
    }),
  };
  return { authorization, capture };
}

describe("captured Skills companion", () => {
  it("returns only the run-token's immutable document, with no current source query", async () => {
    const { authorization, capture } = await fixture();
    const resolve = vi.fn(
      async () =>
        ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization,
        }) as const,
    );
    const reader = createReviewRunSkillsReader({
      resolveReviewRunAuthorizationToken: resolve,
    });
    expect(await reader.read("verified-run-token")).toEqual({
      status: "ready",
      capture,
    });
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      token: "verified-run-token",
    });
  });

  it("does not substitute current Skills for a legacy attachment or drifted base", async () => {
    const { authorization, capture } = await fixture();
    for (const candidate of [
      { ...authorization, skillsSnapshotCanonicalJson: null },
      { ...authorization, runtimeSnapshotCanonicalJson: null },
      {
        ...authorization,
        skillsSnapshotCanonicalJson: canonicalReviewSkillsJson(
          createCapturedReviewSkills({
            webSkills: capture.webSkills,
            gitSources: capture.gitSources,
            baseSha: "f".repeat(40),
          }),
        ),
      },
    ]) {
      const reader = createReviewRunSkillsReader({
        resolveReviewRunAuthorizationToken: async () => ({
          status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
          authorization: candidate,
        }),
      });
      expect(await reader.read("verified-run-token")).toEqual({
        status: "unavailable",
      });
    }
  });

  it.each([
    ReviewRunAuthorizationTokenResolutionStatus.Invalid,
    ReviewRunAuthorizationTokenResolutionStatus.Expired,
    ReviewRunAuthorizationTokenResolutionStatus.Revoked,
    ReviewRunAuthorizationTokenResolutionStatus.ClaimDrift,
  ] as const)("rejects %s tokens", async (status) => {
    const reader = createReviewRunSkillsReader({
      resolveReviewRunAuthorizationToken: async () => ({ status }),
    });
    expect(await reader.read("untrusted")).toEqual({ status: "unauthorized" });
  });

  it("serves bounded no-store JSON and rejects client-selected scope", async () => {
    const { capture } = await fixture();
    const read = vi.fn<ReviewRunSkillsReader["read"]>(async () => ({
      status: "ready",
      capture,
    }));
    const app = Fastify();
    await registerReviewRunSkillsRoute(app, { read });
    try {
      const good = await app.inject({
        method: "POST",
        url: "/api/action/v2/skills",
        headers: { authorization: "Bearer valid-token" },
        payload: {},
      });
      expect(good.statusCode).toBe(200);
      expect(good.headers["cache-control"]).toBe("no-store");
      expect(good.json()).toEqual(capture);
      for (const payload of [
        { workspaceId: "someone-else" },
        { authorizationId: "foreign-run" },
        [],
        null,
      ]) {
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/api/action/v2/skills",
              headers: {
                authorization: "Bearer valid-token",
                "content-type": "application/json",
              },
              payload: JSON.stringify(payload),
            })
          ).statusCode,
        ).toBe(400);
      }
      const selectedScope = await app.inject({
        method: "POST",
        url: "/api/action/v2/skills",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        payload: { workspaceId: "someone-else" },
      });
      expect(selectedScope.statusCode).toBe(400);
      const oversized = await app.inject({
        method: "POST",
        url: "/api/action/v2/skills",
        headers: {
          authorization: "Bearer valid-token",
          "content-type": "application/json",
        },
        payload: JSON.stringify({ payload: "x".repeat(1024) }),
      });
      expect(oversized.statusCode).toBe(413);
      const missingToken = await app.inject({
        method: "POST",
        url: "/api/action/v2/skills",
        payload: {},
      });
      expect(missingToken.statusCode).toBe(401);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("fails closed with safe errors instead of leaking source text or exception details", async () => {
    const app = Fastify();
    const read = vi
      .fn<ReviewRunSkillsReader["read"]>()
      .mockResolvedValueOnce({ status: "unauthorized" })
      .mockResolvedValueOnce({ status: "unavailable" })
      .mockRejectedValueOnce(new Error("private-body-and-token-canary"));
    await registerReviewRunSkillsRoute(app, { read });
    try {
      for (const status of [401, 409, 503]) {
        const response = await app.inject({
          method: "POST",
          url: "/api/action/v2/skills",
          headers: { authorization: "Bearer valid-token" },
          payload: {},
        });
        expect(response.statusCode).toBe(status);
        expect(response.body).not.toContain("private-body-and-token-canary");
        expect(response.headers["cache-control"]).toBe("no-store");
      }
    } finally {
      await app.close();
    }
  });
});
