import {
  providerApiAuthModes,
  providerApiDescriptors,
  reviewModelDispatchContract,
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

function fixture(
  mode: ProviderApiAuthMode = "openrouter-api",
  agentKind: "codex" | "ocr" = "codex",
) {
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
    profileRef: `${agentKind}-default`,
    agentKind,
    packageVersion: "1.0.0",
    binarySha256: "a".repeat(64),
    modelTransports: ["provider_api"],
    contextGateway: agentKind === "codex",
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
    ...(agentKind === "ocr"
      ? {
          modelDispatchCapability: {
            extensionId: reviewModelDispatchContract.extensionId,
            version: 2,
            transport: "runner_local_responses",
            wireProtocol: "openai-responses",
            outputTokenLimit: "upstream_request",
            routeIdentityHash: "d".repeat(64),
            providerIndex: 0,
            model: descriptor.defaultModel,
            deadline: "2126-01-01T00:00:00.000Z",
            maxRequests: 8,
            maxConcurrentRequests: 1,
            maxRequestBytes: 65536,
            maxResponseBytes: 32768,
            maxOutputTokens: 4096,
          },
        }
      : {}),
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

it.each(providerApiAuthModes)(
  "the existing %s checkout admits only its exact captured OCR V2 route",
  async (mode) => {
    const f = fixture(mode, "ocr");
    const otherMode = providerApiAuthModes.find((entry) => entry !== mode)!;
    await expect(
      f.checkout.issue("authorization-token", new AbortController().signal, {
        providerApiAuthMode: otherMode,
        workflowSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(f.issuer).not.toHaveBeenCalled();

    const result = await f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      { providerApiAuthMode: mode, workflowSchemaVersion: 2 },
    );
    expect(result.runtimeConfig.runtimeEnv.REVIEW_AUTH_MODE).toBe(mode);
    expect(
      JSON.parse(
        result.runtimeConfig.runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON!,
      ).agentKind,
    ).toBe("ocr");
    expect(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[
          reviewModelDispatchContract.capabilityRuntimeEnvKey
        ]!,
      ),
    ).toEqual(f.snapshot.modelDispatchCapability);
    expect(f.issuer).toHaveBeenCalledOnce();
  },
);

it.each(["missing", "native-subscription-wire"] as const)(
  "does not admit OCR through the old API checkout with a %s dispatch capability",
  async (mutation) => {
    const f = fixture("openrouter-api", "ocr");
    const snapshot = JSON.parse(f.authorization.runtimeSnapshotCanonicalJson!);
    if (mutation === "missing") delete snapshot.modelDispatchCapability;
    else {
      snapshot.modelDispatchCapability.wireProtocol = "codex-responses";
      snapshot.modelDispatchCapability.outputTokenLimit = "terminal_acceptance";
    }
    Object.assign(f.authorization, {
      runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
    });
    await expect(
      f.checkout.issue("authorization-token", new AbortController().signal, {
        providerApiAuthMode: "openrouter-api",
        workflowSchemaVersion: 2,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(f.issuer).not.toHaveBeenCalled();
  },
);

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
