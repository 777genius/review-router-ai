import {
  providerApiAuthModes,
  providerApiDescriptors,
  type ProviderApiAuthMode,
} from "@reviewrouter/shared";
import Fastify from "fastify";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  canonicalJson,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  createReviewRunProviderApiCheckout,
  registerReviewRunCheckoutRoute,
} from "./review-run-gateway-checkout";

function fixture(mode: ProviderApiAuthMode = "openrouter-api") {
  const descriptor = providerApiDescriptors[mode];
  const configuration = {
    ...workspacePolicyFixture,
    providers: [
      {
        kind: descriptor.providerKind,
        authMode: descriptor.authMode,
        model: descriptor.defaultModel,
        ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    ],
  };
  const agent = {
    profileRef: "codex-default",
    agentKind: "codex",
    packageVersion: "1.0.0",
    binarySha256: "a".repeat(64),
    modelTransports: ["provider_api"],
    contextGateway: true,
    cancellation: true,
  };
  const snapshot = {
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
    agent,
    agentProfileDigest: createHash("sha256")
      .update(canonicalJson(agent))
      .digest("hex"),
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "a".repeat(40),
    },
    configurationCanonicalJson: canonicalJson(configuration),
    deadline: "2126-01-01T00:00:00.000Z",
    gateway: null,
  };
  const authorization = {
    authorizationId: "authorization-1",
    version: 1,
    headSha: "c".repeat(40),
    maxExpiresAt: new Date(snapshot.deadline),
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  } as unknown as ReviewRunAuthorization;
  const issuer = vi.fn(async () => ({
    token: "readonly-token",
    expiresAt: new Date("2126-01-01T00:00:00.000Z"),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  const confirm = vi.fn(async () => true);
  const checkout = createReviewRunProviderApiCheckout({
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization,
      }),
    },
    resolveRepository: async () => ({
      githubInstallationId: "123",
      githubRepositoryId: "456",
      repositoryFullName: "owner/repo",
    }),
    confirmAuthority: confirm,
    issuer: { issueContentsReadToken: issuer },
    maxInFlight: 4,
    timeoutMs: 30_000,
  });
  return { checkout, authorization, snapshot, issuer, confirm };
}

it("exports only frozen direct settings and scoped checkout with no Gateway relay", async () => {
  const { checkout, issuer, confirm } = fixture();
  const result = await checkout.issue(
    "authorization-token",
    new AbortController().signal,
    { providerApiAuthMode: "openrouter-api", workflowSchemaVersion: 2 },
  );
  expect(result.runtimeConfig.runtimeEnv).toMatchObject({
    REVIEW_AUTH_MODE: "openrouter-api",
    REVIEW_PROVIDERS: "openrouter/openai/gpt-5.3-codex",
    CODEX_REASONING_EFFORT: "high",
    UPDATE_PR_DESCRIPTION: "true",
  });
  expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
    "OPENROUTER_API_KEY",
  );
  expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
    "REVIEW_ROUTER_PR_DESCRIPTION_CAPABILITY_JSON",
  );
  expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
    "REVIEW_ROUTER_GATEWAY_BINDING_ID",
  );
  expect(result.permissions).toEqual({
    contents: "read",
    pullRequests: "read",
  });
  expect(issuer).toHaveBeenCalledOnce();
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("denies incompatible frozen policy before minting any SCM token", async () => {
  const { checkout, snapshot, authorization, issuer } = fixture();
  const policy = JSON.parse(snapshot.configurationCanonicalJson);
  policy.providers.push({ ...policy.providers[0] });
  policy.execution.providerLimit = 2;
  policy.execution.providerMaxParallel = 2;
  Object.assign(authorization, {
    runtimeSnapshotCanonicalJson: canonicalJson({
      ...snapshot,
      configurationCanonicalJson: canonicalJson(policy),
    }),
  });
  await expect(
    checkout.issue("authorization-token", new AbortController().signal, {
      providerApiAuthMode: "openrouter-api",
      workflowSchemaVersion: 2,
    }),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(issuer).not.toHaveBeenCalled();
});

it("accepts only the strict finite companion request, independently of Gateway routing", async () => {
  const { checkout, issuer } = fixture();
  const app = Fastify();
  await registerReviewRunCheckoutRoute(app, checkout);
  try {
    for (const payload of [
      '{"providerApiAuthMode":"openrouter-api","providerApiAuthMode":"openrouter-api"}',
      '{"providerApiAuthMode":"openrouter-api","workflowSchemaVersion":2,"providerInstanceId":"fake"}',
      '{"providerApiAuthMode":"other","workflowSchemaVersion":2}',
    ]) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/action/v2/provider-api/checkout",
        headers: {
          authorization: "Bearer authorization-token",
          "content-type": "application/json",
        },
        payload,
      });
      expect(denied.statusCode).toBe(400);
    }
    expect(issuer).not.toHaveBeenCalled();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/action/v2/provider-api/checkout",
      headers: { authorization: "Bearer authorization-token" },
      payload: {
        providerApiAuthMode: "openrouter-api",
        workflowSchemaVersion: 2,
      },
    });
    expect(accepted.statusCode).toBe(200);
  } finally {
    await app.close();
  }
});

it.each(
  providerApiAuthModes.flatMap((saved) =>
    providerApiAuthModes.map((requested) => ({ saved, requested })),
  ),
)(
  "checkout correlates exact captured provider $saved with requested mode $requested",
  async ({ saved, requested }) => {
    const f = fixture(saved);
    const issued = f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      { providerApiAuthMode: requested, workflowSchemaVersion: 2 },
    );
    if (saved !== requested) {
      await expect(issued).rejects.toMatchObject({ statusCode: 401 });
      expect(f.issuer).not.toHaveBeenCalled();
      return;
    }
    const result = await issued;
    const descriptor = providerApiDescriptors[saved];
    expect(result.runtimeConfig.runtimeEnv).toMatchObject({
      REVIEW_AUTH_MODE: saved,
      REVIEW_PROVIDERS: `${descriptor.runtimePrefix}/${descriptor.defaultModel}`,
    });
    for (const mode of providerApiAuthModes)
      expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
        providerApiDescriptors[mode].secretName,
      );
    if (saved === "kimi-code-api")
      expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
        "CODEX_REASONING_EFFORT",
      );
  },
);
