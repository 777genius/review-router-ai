import Fastify from "fastify";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  canonicalJson,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  parseReviewConfigurationStrict,
  providerRuntimeAuthMode,
} from "@reviewrouter/features-review-config";
import { toRuntimeProviderId } from "@reviewrouter/features-review-providers";
import {
  lifecycleVerificationContract,
  lifecycleVerificationContractV2,
  lifecycleVerificationDescriptorDigestV2,
  providerApiAuthModes,
  providerApiDescriptors,
  reviewModelDispatchContract,
  reviewModelTransportForAuthMode,
  type ReviewModelTransport,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  createReviewRunModelRouteCheckout,
  registerReviewRunCheckoutRoute,
} from "./review-run-gateway-checkout";

const providers = [
  workspacePolicyFixture.providers[0]!,
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  },
  ...providerApiAuthModes.map((mode) => ({
    kind: providerApiDescriptors[mode].providerKind,
    authMode: providerApiDescriptors[mode].authMode,
    model: providerApiDescriptors[mode].defaultModel,
    ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  })),
];

function fixture(
  provider: unknown = providers[0],
  confirmHostedRoute?: Parameters<
    typeof createReviewRunModelRouteCheckout
  >[0]["confirmHostedRoute"],
  agentKind: "ocr" | "codex" = "ocr",
) {
  const configuration = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [provider],
  });
  const selected = configuration.providers[0]!;
  const transport = reviewModelTransportForAuthMode(selected.authMode)!;
  const deadline = "2126-01-01T00:00:00.000Z";
  const agent = {
    profileRef: "ocr-prepared-v2",
    agentKind,
    packageVersion: "1.0.0",
    binarySha256: "a".repeat(64),
    modelTransports: ["provider_api"],
    contextGateway: agentKind === "codex",
    cancellation: true,
  };
  const dispatch = {
    extensionId: reviewModelDispatchContract.extensionId,
    version: 2,
    transport,
    wireProtocol:
      transport === "runner_local_anthropic"
        ? "anthropic-messages"
        : selected.authMode === "codex_subscription_oauth_rotating" ||
            transport === "hosted_pool"
          ? "codex-responses"
          : "openai-responses",
    outputTokenLimit:
      selected.authMode === "codex_subscription_oauth_rotating" ||
      transport === "hosted_pool"
        ? "terminal_acceptance"
        : "upstream_request",
    routeIdentityHash: "d".repeat(64),
    providerIndex: 0,
    model:
      transport === "runner_local_anthropic"
        ? "claude-sonnet-4-5-20250929"
        : selected.model,
    ...(transport === "runner_local_anthropic"
      ? { configuredModel: "sonnet" }
      : {}),
    deadline,
    maxRequests: 8,
    maxConcurrentRequests: 1,
    maxRequestBytes: 65536,
    maxResponseBytes: 32768,
    maxOutputTokens: 4096,
  };
  const verifier = {
    extensionId: lifecycleVerificationContractV2.extensionId,
    descriptorDigest: lifecycleVerificationDescriptorDigestV2,
    executor: lifecycleVerificationContract.executor,
    version: 2,
    modelTransport: transport,
    routeIdentityHash: dispatch.routeIdentityHash,
    protocol: dispatch.wireProtocol,
    providerIndex: 0,
    providerKind: agentKind,
    model: dispatch.model,
    maxDispatches: lifecycleVerificationContract.maxPackets,
    maxPromptBytes: 32768,
    maxResponseBytes: 32768,
    maxOutputTokens: 4096,
    deadlineMs: 30_000,
    attemptBudget: 1,
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
    deadline,
    modelDispatchCapability: dispatch,
    lifecycleVerificationCapability: verifier,
    ...(transport === "hosted_pool"
      ? {
          hosted: {
            grantId: "grant-1",
            invocationId: "invocation-1",
            poolId: "pool-1",
            repositoryBindingId: "binding-1",
            activeAccountId: "account-1",
            reviewRequestId: "review-request-1",
            providerInvocationKey: "e".repeat(64),
            policyFingerprint: "f".repeat(64),
            model: selected.model,
            expiresAt: "2126-01-01T00:01:00.000Z",
            bindingRevision: 1,
            runtimeConfigVersion: 1,
            authzEpoch: "1",
            runtimeAuthzEpoch: "1",
          },
        }
      : {}),
    gateway: null,
  };
  const authorization = {
    authorizationId: "authorization-1",
    version: 1,
    headSha: "c".repeat(40),
    maxExpiresAt: new Date(deadline),
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  } as unknown as ReviewRunAuthorization;
  const issuer = vi.fn(async () => ({
    token: "readonly-token",
    expiresAt: new Date(deadline),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  const confirm = vi.fn(async () => true);
  const checkout = createReviewRunModelRouteCheckout({
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
    ...(confirmHostedRoute ? { confirmHostedRoute } : {}),
  });
  const selectors = {
    transport: transport as Exclude<ReviewModelTransport, "account_gateway">,
    providerIndex: 0,
    workflowSchemaVersion: 2 as const,
  };
  return {
    checkout,
    selectors,
    authorization,
    selected,
    snapshot,
    issuer,
    confirm,
  };
}

it.each(providers)(
  "exports one frozen OCR route for $authMode without model credentials",
  async (provider) => {
    const f = fixture(provider);
    const result = await f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      f.selectors,
    );
    const env = result.runtimeConfig.runtimeEnv;
    expect(env.REVIEW_AUTH_MODE).toBe(providerRuntimeAuthMode(f.selected));
    expect(env.REVIEW_PROVIDERS).toBe(toRuntimeProviderId(f.selected));
    expect(
      JSON.parse(env.REVIEW_ROUTER_MODEL_DISPATCH_CAPABILITY_JSON!),
    ).toEqual(f.snapshot.modelDispatchCapability);
    expect(
      JSON.parse(env.REVIEW_ROUTER_LIFECYCLE_VERIFICATION_CAPABILITY_JSON!),
    ).toEqual(f.snapshot.lifecycleVerificationCapability);
    expect(JSON.parse(env.REVIEW_ROUTER_AGENT_PROFILE_JSON!).agentKind).toBe(
      "ocr",
    );
    expect(
      Object.keys(env).some((key) => /API_KEY|AUTH_JSON|OAUTH_TOKEN/.test(key)),
    ).toBe(false);
    expect(result.permissions).toEqual({
      contents: "read",
      pullRequests: "read",
    });
    expect(f.issuer).toHaveBeenCalledOnce();
    expect(f.confirm).toHaveBeenCalledTimes(2);
  },
);

it.each([
  "codex_subscription_oauth_rotating",
  "codex_subscription_oauth_hosted_pool",
])(
  "preserves an approved native supplied-diff engine for %s on the captured model route",
  async (authMode) => {
    const f = fixture(
      { ...providers[0], authMode, agenticContext: false },
      async () => true,
      "codex",
    );
    const result = await f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      f.selectors,
    );
    expect(
      JSON.parse(
        result.runtimeConfig.runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON!,
      ).agentKind,
    ).toBe("codex");
    expect(
      JSON.parse(
        result.runtimeConfig.runtimeEnv
          .REVIEW_ROUTER_MODEL_DISPATCH_CAPABILITY_JSON!,
      ),
    ).toEqual(f.snapshot.modelDispatchCapability);
    expect(f.issuer).toHaveBeenCalledOnce();
  },
);

it("never grants a Codex engine a native Anthropic route", async () => {
  const f = fixture(providers[1], undefined, "codex");
  await expect(
    f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      f.selectors,
    ),
  ).rejects.toThrow("checkout_unavailable");
  expect(f.issuer).not.toHaveBeenCalled();
});

it("denies a mismatched selected route and an expired or absent V2 snapshot before minting", async () => {
  const f = fixture();
  await expect(
    f.checkout.issue("authorization-token", new AbortController().signal, {
      ...f.selectors,
      transport: "runner_local_anthropic",
    }),
  ).rejects.toMatchObject({ statusCode: 401 });
  for (const snapshot of [
    { ...f.snapshot, modelDispatchCapability: undefined },
    {
      ...f.snapshot,
      deadline: "2020-01-01T00:00:00.000Z",
      modelDispatchCapability: {
        ...f.snapshot.modelDispatchCapability,
        deadline: "2020-01-01T00:00:00.000Z",
      },
    },
  ]) {
    Object.assign(f.authorization, {
      runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
    });
    await expect(
      f.checkout.issue(
        "authorization-token",
        new AbortController().signal,
        f.selectors,
      ),
    ).rejects.toThrow();
  }
  expect(f.issuer).not.toHaveBeenCalled();
});

it("never accepts Hosted without its original grant validation and rechecks it after minting", async () => {
  const provider = {
    ...workspacePolicyFixture.providers[0],
    authMode: "codex_subscription_oauth_hosted_pool",
  };
  const denied = fixture(provider);
  await expect(
    denied.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      denied.selectors,
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  expect(denied.issuer).not.toHaveBeenCalled();

  const validate = vi
    .fn(async (_input: { authorization: ReviewRunAuthorization }) => true)
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false);
  const changed = fixture(provider, validate);
  await expect(
    changed.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      changed.selectors,
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  expect(changed.issuer).toHaveBeenCalledOnce();
  expect(validate).toHaveBeenCalledTimes(2);
  expect(validate.mock.calls[0]?.[0]).toMatchObject({
    authorization: changed.authorization,
  });
});

it("does not return a minted SCM token after final current-authority denial", async () => {
  const f = fixture();
  f.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await expect(
    f.checkout.issue(
      "authorization-token",
      new AbortController().signal,
      f.selectors,
    ),
  ).rejects.toMatchObject({ statusCode: 401 });
  expect(f.issuer).toHaveBeenCalledOnce();
});

it("accepts only the exact three model-route selector members and rejects escaped duplicates", async () => {
  const f = fixture();
  const app = Fastify();
  await registerReviewRunCheckoutRoute(app, f.checkout);
  try {
    for (const payload of [
      '{"transport":"runner_local_responses","providerIndex":0,"provider\\u0049ndex":0}',
      '{"transport":"runner_local_responses","providerIndex":0,"workflowSchemaVersion":2,"token":"other"}',
      '{"transport":"account_gateway","providerIndex":0,"workflowSchemaVersion":2}',
      '{"transport":"runner_local_responses","providerIndex":1,"workflowSchemaVersion":2}',
    ]) {
      const denied = await app.inject({
        method: "POST",
        url: "/api/action/v2/model-route/checkout",
        headers: {
          authorization: "Bearer authorization-token",
          "content-type": "application/json",
        },
        payload,
      });
      expect(denied.statusCode).toBe(400);
    }
    expect(f.issuer).not.toHaveBeenCalled();
    const accepted = await app.inject({
      method: "POST",
      url: "/api/action/v2/model-route/checkout",
      headers: { authorization: "Bearer authorization-token" },
      payload: f.selectors,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["cache-control"]).toBe("no-store");
  } finally {
    await app.close();
  }
});
