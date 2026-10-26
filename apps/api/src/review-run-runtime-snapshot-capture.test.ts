import { createHash } from "node:crypto";
import {
  providerApiAuthModes,
  providerApiDescriptors,
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  reviewModelTransportForAuthMode,
  lifecycleVerificationDescriptorDigestV2,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import { lifecycleVerificationDescriptorDigest } from "@reviewrouter/shared";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  parseReviewConfigurationStrict,
} from "@reviewrouter/features-review-config";
import {
  parseReviewAgentProfiles,
  ReviewTrustDomain,
  type VerifiedScmRunIdentity,
} from "@reviewrouter/features-review-run-control";
import { storedPolicyForConfiguration } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  readServerApprovedReviewRunGatewayPolicy,
  readServerReviewAgentProfileRef,
  readServerReviewRunGatewayRequestCaps,
  ProductionReviewRunRuntimeSnapshot,
} from "./review-run-runtime-snapshot";

// Capture-level contract for the explicit agentProfileRef admission lane:
// (1) an invalid or transport-disabled explicit ref denies with
//     agent_profile_unavailable and NEVER falls back to the process-wide
//     REVIEW_ROUTER_AGENT_PROFILE ("codex-default" here);
// (2) an explicit OCR selection saved beside agenticContext=false denies with
//     agent_profile_uncompatible before any gateway binding work.

const workspaceId = "workspace1";
const repositoryConnectionId = "repository1";
const bindingId = "binding-0001";
const gatewayProfileRef = "mimo-responses-v1";

const identity: VerifiedScmRunIdentity = {
  workspaceId,
  repositoryConnectionId,
  scmRepositoryIdentityId: "identity1",
  pullRequestNumber: 1,
  sourceRunId: "run1",
  sourceRunAttempt: "1",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
  mergeBaseSha: "b".repeat(40),
  reviewRevisionHash: "d".repeat(64),
  workflowIdentityHash: "c".repeat(64),
  trustDomain: ReviewTrustDomain.TrustedManaged,
};

const codexDefaultProfile = {
  profileRef: "codex-default",
  agentKind: "codex" as const,
  binarySha256: "a".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway", "provider_api"],
  contextGateway: true as const,
  cancellation: true as const,
};

const directCodexProfile = {
  ...codexDefaultProfile,
  reviewSkillsVersion: 1 as const,
};

const providerApiOnlyProfile = {
  profileRef: "provider-api-only",
  agentKind: "codex" as const,
  binarySha256: "b".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["provider_api"],
  contextGateway: true as const,
  cancellation: true as const,
};

const ocrProfile = {
  profileRef: "approved-ocr",
  agentKind: "ocr" as const,
  binarySha256: "c".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway"],
  contextGateway: false as const,
  cancellation: true as const,
};

const agentProfiles = parseReviewAgentProfiles([
  codexDefaultProfile,
  providerApiOnlyProfile,
  ocrProfile,
]);

function gatewayPolicyJson(options: {
  readonly agentProfileRef?: string;
  readonly agenticContext?: boolean;
}): string {
  return canonicalJson(
    parseReviewConfigurationStrict({
      schemaVersion: 3,
      providers: [
        {
          kind: "codex",
          authMode: "codex_account_gateway",
          model: "mimo-v2-pro",
          reasoningEffort: "high",
          agenticContext: options.agenticContext ?? true,
          fastMode: false,
          requiredHealthy: true,
          gatewayBindingId: bindingId,
          gatewayProfileRef,
          ...(options.agentProfileRef !== undefined
            ? { agentProfileRef: options.agentProfileRef }
            : {}),
        },
      ],
      execution: {
        providerLimit: 1,
        providerMaxParallel: 1,
        inlineMinAgreement: 1,
      },
      blockingPolicy: { failOnSeverity: "critical" },
      limits: { inlineMaxComments: 10, targetTokensPerBatch: 4000 },
      reviewLanguage: null,
      investigationRollout: {
        recordingEnabled: false,
        shadowEnabled: false,
        contextCriticEnabled: false,
        verifiedCleanEnabled: false,
        crossRevisionReplayEnabled: false,
        productionEffectsEnabled: false,
      },
    }),
  );
}

type PolicyRow = {
  readonly version: number;
  readonly schemaVersion: number;
  readonly policyJson: string | null;
};

function fakeRuntimeReader(input: {
  readonly workspace: PolicyRow | null;
  readonly repository?: PolicyRow | null;
  readonly profileRows?: readonly unknown[];
}) {
  return {
    workspaceProviderProfile: {
      findMany: async () => input.profileRows ?? [],
    },
    reviewConfiguration: {
      findUnique: async (args: {
        where: { workspaceId_targetKey: { targetKey: string } };
      }) => {
        const row =
          args.where.workspaceId_targetKey.targetKey === "workspace:default"
            ? input.workspace
            : (input.repository ?? null);
        return row ? { versions: [row] } : null;
      },
    },
    workspaceAccountBinding: {
      findUnique: async () => ({
        id: bindingId,
        workspaceId,
        connectionId: "connection1",
        state: "active",
        revision: 1,
        policyRevision: 1,
        pendingFenceOperationId: null,
        pendingFencePolicySubject: null,
        pendingFencePolicyRevision: null,
        fenceAckOperationId: null,
        fenceAckPolicyRevision: null,
        workspace: { personalOwnerUserId: null, deletionState: "active" },
        connection: {
          id: "connection1",
          ownerWorkspaceId: workspaceId,
          ownerUserId: null,
          gatewayAccountRef: "account-1",
          gatewayOperationRef: null,
          profileRef: gatewayProfileRef,
          displayName: "test binding",
          state: "active",
          metadataRevision: 1,
          authorizationEpochMirror: null,
          pendingSourceOperationId: null,
          ownerWorkspace: null,
          ownerUser: null,
        },
      }),
    },
  } as unknown as Pick<
    PrismaClient,
    | "reviewConfiguration"
    | "workspaceProviderProfile"
    | "workspaceAccountBinding"
  >;
}

function snapshotSource(
  outputBytes = 196608,
  agentProfileRef: string | null = "codex-default",
) {
  return new ProductionReviewRunRuntimeSnapshot(
    {} as PrismaClient,
    {
      profiles: [
        {
          profileRef: gatewayProfileRef,
          limits: {
            requests: 2,
            concurrency: 1,
            requestBytes: 4096,
            outputBytes,
            tokens: 128,
          },
        },
      ],
    },
    undefined,
    false,
    agentProfileRef ?? undefined,
  );
}

function captureInput(options?: {
  readonly modelTransport?: "account_gateway";
}) {
  return {
    identity,
    deadline: new Date("2126-10-19T12:00:00.000Z"),
    modelTransport: options?.modelTransport ?? ("account_gateway" as const),
    producerRelease: {
      producerReleaseId: "release-1",
      actionCommitSha: "a".repeat(40),
      runtimeCommitSha: "b".repeat(40),
      agentProfiles,
    },
  };
}

/** The stored documents and profiles that materialize this configuration. */
function readerFor(policyJson: string) {
  const stored = storedPolicyForConfiguration(
    parseReviewConfigurationStrict(JSON.parse(policyJson)),
    { workspaceId, repositoryId: repositoryConnectionId },
  );
  return fakeRuntimeReader({
    workspace: stored.workspaceHead,
    repository: stored.repositoryHead,
    profileRows: stored.profileRows,
  });
}

describe("one prepared route for discovery and verification", () => {
  const profile: ReviewModelDispatchProfileV2 = {
    extensionId: reviewModelDispatchContract.extensionId,
    descriptorDigest: reviewModelDispatchDescriptorDigest,
    policyVersion: reviewModelDispatchContract.policyVersion,
    transports: [
      "account_gateway",
      "runner_local_responses",
      "runner_local_anthropic",
      "hosted_pool",
    ],
    defaultAgentProfileRefs: {
      account_gateway: "ocr-unified",
      runner_local_responses: "ocr-unified",
      runner_local_anthropic: "ocr-unified",
      hosted_pool: "ocr-unified",
    },
    limits: {
      maxRequests: 32,
      maxConcurrentRequests: 1,
      maxRequestBytes: 16777216,
      maxResponseBytes: 8388608,
      maxOutputTokens: 32768,
    },
  };
  const profiles = parseReviewAgentProfiles([
    directCodexProfile,
    ocrProfile,
    {
      ...ocrProfile,
      profileRef: "ocr-unified",
      modelTransports: ["account_gateway", "provider_api"],
      reviewSkillsVersion: 1,
    },
    {
      ...ocrProfile,
      profileRef: "retained-ocr-skills",
      reviewSkillsVersion: 1,
    },
  ]);
  const providerRows = [
    ...providerApiAuthModes.map((mode) => ({
      mode,
      provider: {
        kind: providerApiDescriptors[mode].providerKind,
        authMode: providerApiDescriptors[mode].authMode,
        model: providerApiDescriptors[mode].defaultModel,
        ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    })),
    ...[
      "codex_subscription_oauth_rotating",
      "codex_subscription_oauth_hosted_pool",
    ].map((authMode) => ({
      mode: undefined,
      provider: {
        kind: "codex",
        authMode,
        model: "gpt-5.4",
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    })),
    {
      mode: undefined,
      provider: {
        kind: "claude",
        authMode: "claude_code_oauth",
        model: "claude-sonnet-4-6",
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    },
  ];
  it.each(providerRows)(
    "captures OCR and the same verifier route for $provider.authMode",
    async ({ mode, provider }) => {
      const configuration = parseReviewConfigurationStrict({
        ...JSON.parse(gatewayPolicyJson({})),
        providers: [provider],
      });
      const captured = await snapshotSource().capture(
        {
          ...captureInput(),
          modelTransport: "provider_api",
          ...(mode ? { providerApiAuthMode: mode } : {}),
          producerRelease: {
            ...captureInput().producerRelease,
            agentProfiles: profiles,
            modelDispatchProfile: profile,
          },
        },
        readerFor(canonicalJson(configuration)),
      );
      expect(captured).toMatchObject({
        agent: { agentKind: "ocr", profileRef: "ocr-unified" },
        gateway: null,
        modelDispatchCapability: {
          transport: reviewModelTransportForAuthMode(provider.authMode),
          model: provider.model,
          maxRequests: 32,
        },
        lifecycleVerificationCapability: {
          extensionId: "lifecycle-verification.v2",
          descriptorDigest: lifecycleVerificationDescriptorDigestV2,
          providerKind: "ocr",
          model: provider.model,
          attemptBudget: 1,
        },
      });
      if (!captured || "captureDenied" in captured)
        throw new Error("capture_missing");
      expect(captured.lifecycleVerificationCapability).toMatchObject({
        routeIdentityHash: captured.modelDispatchCapability!.routeIdentityHash,
      });
      expect(captured.configurationCanonicalJson).toBe(
        canonicalJson(configuration),
      );
    },
  );

  it("preserves supplied-diff policy and never lets retained OCR profiles choose a default", async () => {
    const provider = { ...providerRows[0]!.provider, agenticContext: false };
    const configuration = parseReviewConfigurationStrict({
      ...JSON.parse(gatewayPolicyJson({})),
      providers: [provider],
    });
    const captured = await snapshotSource().capture(
      {
        ...captureInput(),
        modelTransport: "provider_api",
        providerApiAuthMode: providerRows[0]!.mode!,
        producerRelease: {
          ...captureInput().producerRelease,
          agentProfiles: profiles,
          modelDispatchProfile: profile,
        },
      },
      readerFor(canonicalJson(configuration)),
    );
    expect(captured).toMatchObject({
      agent: { agentKind: "codex" },
      lifecycleVerificationCapability: {
        extensionId: "lifecycle-verification.v2",
        providerKind: "codex",
      },
    });
    expect(
      captured &&
        !("captureDenied" in captured) &&
        captured.configurationCanonicalJson,
    ).toBe(canonicalJson(configuration));
  });
});

describe("PR description capture availability", () => {
  it.each([
    ["codex_account_gateway", true, true],
    ["openrouter_api_key", true, true],
    ["codex_subscription_oauth_rotating", true, false],
    ["codex_account_gateway", false, false],
  ] as const)(
    "captures approved capability for %s with producer approval=%s",
    async (authMode, approved, available) => {
      const configuration = parseReviewConfigurationStrict(
        JSON.parse(gatewayPolicyJson({})),
      );
      if (authMode !== "codex_account_gateway") {
        configuration.providers = [
          {
            kind: authMode === "openrouter_api_key" ? "openrouter" : "codex",
            authMode,
            model:
              authMode === "openrouter_api_key" ? "openai/gpt-5.4" : "gpt-5.4",
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
        ];
      }
      const prDescriptionProfile = {
        extensionId: "pr-description.v1" as const,
        canonicalizerDigest: "e".repeat(64),
      };
      const captured = await snapshotSource().capture(
        {
          ...captureInput(),
          modelTransport:
            authMode === "codex_account_gateway"
              ? "account_gateway"
              : "provider_api",
          ...(authMode === "openrouter_api_key"
            ? { providerApiAuthMode: "openrouter-api" as const }
            : {}),
          producerRelease: {
            ...captureInput().producerRelease,
            agentProfiles: parseReviewAgentProfiles([
              authMode === "openrouter_api_key"
                ? directCodexProfile
                : codexDefaultProfile,
            ]),
            ...(approved ? { prDescriptionProfile } : {}),
          },
        },
        readerFor(canonicalJson(configuration)),
      );
      expect(captured).not.toBeNull();
      expect(captured).not.toHaveProperty("captureDenied");
      if (available) {
        expect(captured).toHaveProperty(
          "prDescriptionCapability",
          prDescriptionProfile,
        );
      } else {
        expect(captured).not.toHaveProperty("prDescriptionCapability");
      }
    },
  );
});

describe("ProductionReviewRunRuntimeSnapshot explicit agentProfileRef capture", () => {
  it("treats a stale workflow transport as changed facts before resolving an explicit engine", async () => {
    expect(
      await snapshotSource().capture(
        { ...captureInput(), modelTransport: "provider_api" },
        readerFor(gatewayPolicyJson({ agentProfileRef: "missing-profile" })),
      ),
    ).toBeNull();
  });
  it("denies an unresolvable explicit ref with agent_profile_unavailable and never falls back to the configured default", async () => {
    const source = snapshotSource();
    // Discriminating by construction: the process default ("codex-default")
    // resolves to a full snapshot in this exact fixture, so any silent
    // fallback would make the denied case below return this same snapshot.
    const control = await source.capture(
      captureInput(),
      readerFor(gatewayPolicyJson({})),
    );
    expect(control).toMatchObject({
      agent: { profileRef: "codex-default", agentKind: "codex" },
    });
    const denied = await source.capture(
      captureInput(),
      readerFor(gatewayPolicyJson({ agentProfileRef: "missing-profile" })),
    );
    expect(denied).toEqual({ captureDenied: "agent_profile_unavailable" });
  });

  it.each([
    { label: "unknown", agentProfileRef: "missing-profile" },
    { label: "transport-disabled", agentProfileRef: "provider-api-only" },
  ])(
    "denies a $label explicit ref without fallback to the configured default",
    async ({ agentProfileRef }) => {
      const denied = await snapshotSource().capture(
        captureInput(),
        readerFor(gatewayPolicyJson({ agentProfileRef })),
      );
      expect(denied).toEqual({ captureDenied: "agent_profile_unavailable" });
    },
  );

  it("answers an explicit OCR selection beside supplied-diff-only with agent_profile_uncompatible", async () => {
    const source = snapshotSource();
    // Control: the same explicit OCR selection beside native agentic context
    // captures normally, so the denial below is about agenticContext=false.
    const control = await source.capture(
      captureInput(),
      readerFor(gatewayPolicyJson({ agentProfileRef: "approved-ocr" })),
    );
    expect(control).toMatchObject({
      agent: { profileRef: "approved-ocr", agentKind: "ocr" },
    });
    const denied = await source.capture(
      captureInput(),
      readerFor(
        gatewayPolicyJson({
          agentProfileRef: "approved-ocr",
          agenticContext: false,
        }),
      ),
    );
    expect(denied).toEqual({ captureDenied: "agent_profile_incompatible" });
  });

  it("keeps a non-OCR explicit selection beside supplied-diff-only admissible", async () => {
    const captured = await snapshotSource().capture(
      captureInput(),
      readerFor(
        gatewayPolicyJson({
          agentProfileRef: "codex-default",
          agenticContext: false,
        }),
      ),
    );
    expect(captured).toMatchObject({
      agent: { profileRef: "codex-default", agentKind: "codex" },
    });
  });
});

describe("managed review engine default", () => {
  const approvedProfiles = parseReviewAgentProfiles([
    codexDefaultProfile,
    { ...ocrProfile, profileRef: "ocr-managed-v2" },
  ]);
  const input = () => ({
    ...captureInput(),
    producerRelease: {
      ...captureInput().producerRelease,
      agentProfiles: approvedProfiles,
    },
  });

  it("uses qualified OCR for existing implicit Gateway policy without rewriting it", async () => {
    expect(readServerReviewAgentProfileRef(undefined)).toBe("ocr-managed-v2");
    expect(readServerReviewAgentProfileRef("codex-default")).toBe(
      "codex-default",
    );
    const policyJson = gatewayPolicyJson({});
    const captured = await snapshotSource(196608, null).capture(
      input(),
      readerFor(policyJson),
    );
    expect(captured).toMatchObject({
      agent: {
        profileRef: "ocr-managed-v2",
        agentKind: "ocr",
        contextGateway: false,
      },
      configurationCanonicalJson: policyJson,
    });
    const explicit = await snapshotSource(196608, null).capture(
      input(),
      readerFor(gatewayPolicyJson({ agentProfileRef: "codex-default" })),
    );
    expect(explicit).toMatchObject({ agent: codexDefaultProfile });
  });

  it("preserves an implicit supplied-diff-only policy and denies ambiguous compatibility", async () => {
    const source = snapshotSource(196608, null);
    const reader = readerFor(gatewayPolicyJson({ agenticContext: false }));
    expect(await source.capture(input(), reader)).toMatchObject({
      agent: { profileRef: "codex-default", agentKind: "codex" },
    });
    expect(
      await source.capture(
        {
          ...input(),
          producerRelease: {
            ...input().producerRelease,
            agentProfiles: parseReviewAgentProfiles([
              ...approvedProfiles,
              { ...codexDefaultProfile, profileRef: "other-codex" },
            ]),
          },
        },
        reader,
      ),
    ).toEqual({ captureDenied: "agent_profile_unavailable" });
  });

  it("denies an unqualified managed OCR default without falling back", async () => {
    expect(
      await snapshotSource(196608, null).capture(
        captureInput(),
        readerFor(gatewayPolicyJson({})),
      ),
    ).toEqual({ captureDenied: "agent_profile_unavailable" });
  });

  it("keeps provider-api execution on its qualified Codex profile", async () => {
    const configuration = parseReviewConfigurationStrict(
      JSON.parse(gatewayPolicyJson({})),
    );
    configuration.providers = [
      {
        kind: "codex",
        authMode: "codex_subscription_oauth_rotating",
        model: "gpt-5.4",
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    ];
    expect(
      await snapshotSource(196608, null).capture(
        {
          ...input(),
          modelTransport: "provider_api",
        },
        readerFor(canonicalJson(configuration)),
      ),
    ).toMatchObject({
      agent: { profileRef: "codex-default", agentKind: "codex" },
      gateway: null,
    });
  });
});

describe("captured Gateway raw Responses output budget", () => {
  it.each([1024 * 1024, 8 * 1024 * 1024])(
    "captures the approved %i byte allowance without upgrading historical limits",
    async (outputBytes) => {
      const result = await snapshotSource(outputBytes).capture(
        captureInput(),
        readerFor(gatewayPolicyJson({})),
      );
      expect(result).toMatchObject({ gateway: { limits: { outputBytes } } });
    },
  );

  it("refuses unsupported server policy before any authorization or Gateway request", () => {
    const limits = {
      requests: 128,
      concurrency: 1,
      requestBytes: 4096,
      outputBytes: 8 * 1024 * 1024 + 1,
      tokens: 32768,
    };
    expect(() =>
      readServerApprovedReviewRunGatewayPolicy(
        JSON.stringify({
          profiles: [{ profileRef: gatewayProfileRef, limits }],
        }),
      ),
    ).toThrow("review_run_gateway_policy_invalid");
    expect(() => snapshotSource(limits.outputBytes)).toThrow(
      "review_run_gateway_policy_invalid",
    );
  });
});

describe("direct OpenRouter admission", () => {
  const policy = () => {
    const base = JSON.parse(gatewayPolicyJson({}));
    base.providers = [
      {
        kind: "openrouter",
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    ];
    return base;
  };
  it("captures one native engine with OpenRouter provenance and rejects a second vote", async () => {
    const config = policy();
    const input = {
      ...captureInput(),
      modelTransport: "provider_api" as const,
      providerApiAuthMode: "openrouter-api" as const,
      producerRelease: {
        ...captureInput().producerRelease,
        agentProfiles: parseReviewAgentProfiles([
          directCodexProfile,
          ocrProfile,
        ]),
      },
    };
    const accepted = await snapshotSource().capture(
      input,
      readerFor(canonicalJson(parseReviewConfigurationStrict(config))),
    );
    expect(accepted).toMatchObject({
      gateway: null,
      agent: { agentKind: "codex" },
      configurationCanonicalJson: canonicalJson(
        parseReviewConfigurationStrict(config),
      ),
    });
    expect(() =>
      parseReviewConfigurationStrict({
        ...config,
        providers: [...config.providers, { ...config.providers[0] }],
      }),
    ).toThrow("duplicate review provider");
    config.providers.push({
      ...config.providers[0],
      model: "anthropic/claude-sonnet-4",
    });
    config.execution.providerLimit = 2;
    config.execution.providerMaxParallel = 2;
    await expect(
      snapshotSource().capture(
        input,
        readerFor(canonicalJson(parseReviewConfigurationStrict(config))),
      ),
    ).resolves.toBeNull();
    await expect(
      snapshotSource().capture(input, readerFor(gatewayPolicyJson({}))),
    ).resolves.toBeNull();
  });
});

describe("lifecycle verification capture", () => {
  const profile = {
    extensionId: "lifecycle-verification.v1" as const,
    descriptorDigest: lifecycleVerificationDescriptorDigest,
  };
  const qualified = [
    {
      profile: {
        profileId: gatewayProfileRef,
        protocol: "openai-responses",
        modelIds: ["mimo-v2-pro"],
      },
      outputTokens: 2048,
    },
  ];
  function source(qualification = qualified) {
    return new ProductionReviewRunRuntimeSnapshot(
      {} as PrismaClient,
      {
        profiles: [
          {
            profileRef: gatewayProfileRef,
            limits: {
              requests: 9,
              concurrency: 1,
              requestBytes: 64000,
              outputBytes: 20000,
              tokens: 4096,
            },
          },
        ],
      },
      undefined,
      false,
      "codex-default",
      false,
      { profiles: qualification, ingressBytes: 32000, requestTimeoutMs: 30000 },
    );
  }
  it("captures the saved model and lower qualified bounds without partitioning R", async () => {
    const captured = await source().capture(
      {
        ...captureInput(),
        producerRelease: {
          ...captureInput().producerRelease,
          lifecycleVerificationProfile: profile,
        },
      },
      readerFor(gatewayPolicyJson({})),
    );
    expect(captured).toMatchObject({
      gateway: { limits: { requests: 9 } },
      lifecycleVerificationCapability: {
        ...profile,
        providerIndex: 0,
        providerKind: "codex",
        model: "mimo-v2-pro",
        maxOutputTokens: 2048,
        maxPromptBytes: 32000,
        deadlineMs: 30000,
        maxResponseBytes: 20000,
        maxDispatches: 2,
        attemptBudget: 1,
      },
    });
    expect(captured).not.toHaveProperty(
      "lifecycleVerificationUnavailableReason",
    );
  });
  it("keeps direct OpenRouter unavailable even with an approved verifier producer", async () => {
    const configuration = parseReviewConfigurationStrict(
      JSON.parse(gatewayPolicyJson({})),
    );
    configuration.providers = [
      {
        kind: "openrouter",
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.4",
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
    ];
    const captured = await source().capture(
      {
        ...captureInput(),
        modelTransport: "provider_api",
        providerApiAuthMode: "openrouter-api",
        producerRelease: {
          ...captureInput().producerRelease,
          agentProfiles: parseReviewAgentProfiles([directCodexProfile]),
          lifecycleVerificationProfile: profile,
        },
      },
      readerFor(canonicalJson(configuration)),
    );
    expect(captured).not.toHaveProperty("captureDenied");
    expect(captured).not.toHaveProperty("lifecycleVerificationCapability");
    expect(captured).toHaveProperty(
      "lifecycleVerificationUnavailableReason",
      "verification_unavailable",
    );
  });
  it("preserves discovery on invalid approval and unavailable model qualification", async () => {
    for (const [approval, qualification, reason] of [
      [
        { ...profile, descriptorDigest: `sha256:${"f".repeat(64)}` },
        qualified,
        "verification_configuration_invalid",
      ],
      [profile, [], "verification_unavailable"],
      [
        profile,
        [{ ...qualified[0]!, outputTokens: 1023 }],
        "verification_unavailable",
      ],
    ] as const) {
      const captured = await source([...qualification]).capture(
        {
          ...captureInput(),
          producerRelease: {
            ...captureInput().producerRelease,
            lifecycleVerificationProfile: approval,
          },
        },
        readerFor(gatewayPolicyJson({})),
      );
      expect(captured).not.toHaveProperty("captureDenied");
      expect(captured).toHaveProperty(
        "lifecycleVerificationUnavailableReason",
        reason,
      );
      expect(captured).not.toHaveProperty("lifecycleVerificationCapability");
    }
    const legacy = await source().capture(
      captureInput(),
      readerFor(gatewayPolicyJson({})),
    );
    expect(legacy).not.toHaveProperty("lifecycleVerificationCapability");
    expect(legacy).not.toHaveProperty("lifecycleVerificationUnavailableReason");
  });
});

describe("server scoped Gateway request ceilings", () => {
  const rule = {
    workspaceId,
    repositoryConnectionId,
    scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
    pullRequestNumber: identity.pullRequestNumber,
    profileRef: gatewayProfileRef,
    bindingId,
    maxRequests: 9,
  };
  function source(rules: readonly (typeof rule)[]) {
    return new ProductionReviewRunRuntimeSnapshot(
      {} as PrismaClient,
      {
        profiles: [
          {
            profileRef: gatewayProfileRef,
            limits: {
              requests: 640,
              concurrency: 1,
              requestBytes: 98304,
              outputBytes: 196608,
              tokens: 4096,
            },
          },
        ],
      },
      undefined,
      false,
      "codex-default",
      false,
      {
        profiles: [],
        ingressBytes: 98304,
        requestTimeoutMs: 60000,
        requestCaps: rules,
      },
    );
  }
  async function captured(s = source([rule]), input = captureInput()) {
    const result = await s.capture(input, readerFor(gatewayPolicyJson({})));
    if (!result || "captureDenied" in result) throw new Error("capture failed");
    return result;
  }
  it("lowers only the exact server-scoped PR grant and ignores caller cap fields", async () => {
    expect((await captured()).gateway?.limits.requests).toBe(9);
    for (const changed of [
      { workspaceId: "other" },
      { repositoryConnectionId: "other" },
      { scmRepositoryIdentityId: "other" },
      { pullRequestNumber: 2 },
      { profileRef: "other" },
      { bindingId: "other" },
    ]) {
      expect(
        (await captured(source([{ ...rule, ...changed }]))).gateway?.limits
          .requests,
      ).toBe(640);
    }
    expect(
      (await captured(source([{ ...rule, maxRequests: 1000 }]))).gateway?.limits
        .requests,
    ).toBe(640);
    const forged = {
      ...captureInput(),
      requestCaps: [{ ...rule, maxRequests: 1000 }],
      maxRequests: 1000,
    };
    expect(
      (await captured(source([rule]), forged)).gateway?.limits.requests,
    ).toBe(9);
    expect(
      (await captured(source([]), { ...captureInput(), ...{ maxRequests: 1 } }))
        .gateway?.limits.requests,
    ).toBe(640);
  });
  it("keeps captured R9 through restore and rejects only over-cap existing grants in that exact scope", async () => {
    const bounded = await captured();
    const old = await captured(source([]));
    const live = (s: ReturnType<typeof source>, snapshot: typeof bounded) =>
      s.isLive(
        { snapshot, identity, now: new Date("2026-10-25T00:00:00.000Z") },
        readerFor(gatewayPolicyJson({})),
      );
    expect(await live(source([rule]), bounded)).toBe(true);
    expect(await live(source([]), bounded)).toBe(true);
    expect(bounded.gateway?.limits.requests).toBe(9);
    expect(await live(source([rule]), old)).toBe(false);
    expect(
      await live(
        source([{ ...rule, repositoryConnectionId: "unrelated" }]),
        old,
      ),
    ).toBe(true);
  });
  it("strictly validates finite operator rules and detaches them from later mutation", async () => {
    expect(readServerReviewRunGatewayRequestCaps(undefined)).toEqual([]);
    for (const value of [
      [{ ...rule, callerCanRaise: true }],
      [{ ...rule, maxRequests: 0 }],
      [{ ...rule, maxRequests: 1.5 }],
      [{ ...rule, pullRequestNumber: 0 }],
      [rule, rule],
      { rules: [rule] },
    ])
      expect(() =>
        readServerReviewRunGatewayRequestCaps(JSON.stringify(value)),
      ).toThrow("review_run_gateway_request_caps_invalid");
    const mutable = { ...rule };
    const instance = source([mutable]);
    mutable.maxRequests = 640;
    expect((await captured(instance)).gateway?.limits.requests).toBe(9);
  });
});

it.each(
  providerApiAuthModes.flatMap((saved) =>
    providerApiAuthModes.map((caller) => ({ saved, caller })),
  ),
)(
  "captures only canonical caller $caller correlated with saved provider $saved",
  async ({ saved, caller }) => {
    const base = JSON.parse(gatewayPolicyJson({}));
    const descriptor = providerApiDescriptors[saved];
    base.providers = [
      {
        kind: descriptor.providerKind,
        authMode: descriptor.authMode,
        model: descriptor.defaultModel,
        ...(saved === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
        fastMode: false,
        agenticContext: true,
        requiredHealthy: true,
      },
    ];
    const input = {
      ...captureInput(),
      modelTransport: "provider_api" as const,
      providerApiAuthMode: caller,
      producerRelease: {
        ...captureInput().producerRelease,
        agentProfiles: parseReviewAgentProfiles([directCodexProfile]),
      },
    };
    const result = await snapshotSource().capture(
      input,
      readerFor(canonicalJson(parseReviewConfigurationStrict(base))),
    );
    if (caller !== saved) expect(result).toBeNull();
    else
      expect(result).toMatchObject({
        gateway: null,
        configurationCanonicalJson: canonicalJson(
          parseReviewConfigurationStrict(base),
        ),
        agent: { agentKind: "codex" },
      });
  },
);

it.each(providerApiAuthModes)(
  "legacy caller cannot bootstrap direct policy without canonical proof: %s",
  async (mode) => {
    const base = JSON.parse(gatewayPolicyJson({}));
    const d = providerApiDescriptors[mode];
    base.providers = [
      {
        kind: d.providerKind,
        authMode: d.authMode,
        model: d.defaultModel,
        ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
        fastMode: false,
        agenticContext: true,
        requiredHealthy: true,
      },
    ];
    const input = {
      ...captureInput(),
      modelTransport: "provider_api" as const,
      producerRelease: {
        ...captureInput().producerRelease,
        agentProfiles: parseReviewAgentProfiles([codexDefaultProfile]),
      },
    };
    expect(
      await snapshotSource().capture(
        input,
        readerFor(canonicalJson(parseReviewConfigurationStrict(base))),
      ),
    ).toBeNull();
  },
);

it.each(providerApiAuthModes)(
  "new direct %s capture requires a replayable approved agent witness",
  async (mode) => {
    const base = JSON.parse(gatewayPolicyJson({}));
    const d = providerApiDescriptors[mode];
    base.providers = [
      {
        kind: d.providerKind,
        authMode: d.authMode,
        model: d.defaultModel,
        ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
        fastMode: false,
        agenticContext: true,
        requiredHealthy: true,
      },
    ];
    const result = await snapshotSource().capture(
      {
        ...captureInput(),
        modelTransport: "provider_api",
        providerApiAuthMode: mode,
        producerRelease: {
          ...captureInput().producerRelease,
          agentProfiles: parseReviewAgentProfiles([codexDefaultProfile]),
        },
      },
      readerFor(canonicalJson(parseReviewConfigurationStrict(base))),
    );
    expect(result).toEqual({ captureDenied: "agent_profile_unavailable" });
  },
);

it.each(providerApiAuthModes)(
  "admission replay preserves original %s proof and rejects a changed current provider",
  async (mode) => {
    const configuration = (selected: (typeof providerApiAuthModes)[number]) => {
      const base = JSON.parse(gatewayPolicyJson({}));
      const d = providerApiDescriptors[selected];
      base.providers = [
        {
          kind: d.providerKind,
          authMode: d.authMode,
          model: d.defaultModel,
          ...(selected === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
          fastMode: false,
          agenticContext: true,
          requiredHealthy: true,
        },
      ];
      return canonicalJson(parseReviewConfigurationStrict(base));
    };
    const producerRelease = {
      ...captureInput().producerRelease,
      agentProfiles: parseReviewAgentProfiles([directCodexProfile]),
    };
    const source = snapshotSource();
    const original = await source.capture(
      {
        ...captureInput(),
        modelTransport: "provider_api",
        providerApiAuthMode: mode,
        producerRelease,
      },
      readerFor(configuration(mode)),
    );
    expect(original).toMatchObject({ agent: { reviewSkillsVersion: 1 } });
    const candidate = {
      ...identity,
      producerReleaseId: producerRelease.producerReleaseId,
      maxExpiresAt: captureInput().deadline,
      runtimeSnapshotCanonicalJson: canonicalJson(original),
    } as unknown as Parameters<
      ProductionReviewRunRuntimeSnapshot["matchesAdmission"]
    >[1];
    const transaction = (policy: string) =>
      ({
        ...readerFor(policy),
        producerRelease: {
          findUnique: async () => ({
            ...producerRelease,
            agentProfilesJson: JSON.stringify(producerRelease.agentProfiles),
            contextToolsProfile: null,
            prDescriptionProfile: null,
            lifecycleVerificationProfile: null,
          }),
        },
        $queryRaw: async () => [{ id: workspaceId }],
      }) as unknown as Parameters<
        ProductionReviewRunRuntimeSnapshot["matchesAdmission"]
      >[0];
    expect(
      await source.matchesAdmission(
        transaction(configuration(mode)),
        candidate,
      ),
    ).toBe(true);
    const different = providerApiAuthModes.find((value) => value !== mode)!;
    expect(
      await source.matchesAdmission(
        transaction(configuration(different)),
        candidate,
      ),
    ).toBe(false);
    // Legacy non-witness bytes remain parseable; they do not acquire new direct proof.
    if (!original || "captureDenied" in original)
      throw new Error("fixture_capture_missing");
    const legacyAgent = { ...original.agent };
    delete legacyAgent.reviewSkillsVersion;
    const legacy = {
      ...original,
      agent: legacyAgent,
      agentProfileDigest: createHash("sha256")
        .update(canonicalJson(legacyAgent))
        .digest("hex"),
    };
    expect(
      await source.matchesAdmission(transaction(configuration(mode)), {
        ...candidate,
        runtimeSnapshotCanonicalJson: canonicalJson(legacy),
      }),
    ).toBe(false);
  },
);
