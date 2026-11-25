import type {
  PrismaClient,
  ProducerRelease as PersistedRelease,
} from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseReviewConfigurationStrict,
  type EffectiveReviewConfiguration,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  contextToolsDescriptorDigest,
  type ProducerContextToolsProfile,
} from "@reviewrouter/features-review-context-tools";
import { reviewActionV2SupportedContracts } from "@reviewrouter/protocol-review-action-v2";
import { readRepositorySkillsReadiness } from "./repository-skills-readiness";

const h = vi.hoisted(() => ({ policies: vi.fn() }));
vi.mock("@reviewrouter/features-review-config", async (original) => ({
  ...(await original<typeof import("@reviewrouter/features-review-config")>()),
  resolveEffectiveReviewConfigurations: h.policies,
}));

const legacy = {
  profileRef: "codex-default",
  agentKind: "codex",
  binarySha256: "a".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway", "provider_api"],
  contextGateway: true,
  cancellation: true,
};
const supporting = {
  ...legacy,
  profileRef: "codex-skills-v1",
  reviewSkillsVersion: 1,
};
const ocr = {
  ...legacy,
  profileRef: "ocr-managed-v3",
  agentKind: "ocr",
  contextGateway: false,
  modelTransports: ["account_gateway"],
  reviewSkillsVersion: 1,
};
const contract = reviewActionV2SupportedContracts()[0]!;
const attestation = (
  suffix = "a",
  agentProfiles: readonly unknown[] | null = [legacy, supporting, ocr],
  contextToolsProfile?: ProducerContextToolsProfile,
) => ({
  producerReleaseId: `release-${suffix}`,
  distributionKind: "public_reusable",
  actionCommitSha: suffix.repeat(40),
  runtimeCommitSha: "b".repeat(40),
  wrapperEntrypointDigest: null,
  runtimeEntrypointDigest: "c".repeat(64),
  contextGatewayPolicyVersion: null,
  contextGatewayEntrypointDigest: null,
  agentProfiles,
  ...(contextToolsProfile === undefined ? {} : { contextToolsProfile }),
  schemaDigest: contract.schemaDigest,
  canonicalizerDigest: contract.canonicalizerDigest,
  capabilityProfile: "exact_revision_v2",
  protocolLimitsProfileId: "limits-1",
  operationalSloProfileId: "slo-1",
  reviewInvestigationCapability: null,
  reviewInvestigationCoverageProfileHash: null,
  reviewInvestigationPolicyHash: null,
});
function persisted(source = attestation()): PersistedRelease {
  const {
    agentProfiles,
    canonicalizerDigest: _canonicalizer,
    ...rest
  } = source;
  void _canonicalizer;
  return {
    ...rest,
    agentProfilesJson:
      agentProfiles === null ? null : JSON.stringify(agentProfiles),
    contextToolsProfile: null,
    prDescriptionProfile: null,
    state: "registered",
    registeredAt: new Date(0),
    revokedAt: null,
  } as PersistedRelease;
}
function config(
  input: {
    authMode?: string;
    agentProfileRef?: string;
    agenticContext?: boolean;
    contextTools?: ReviewConfiguration["contextTools"];
  } = {},
) {
  const authMode = input.authMode ?? "codex_account_gateway";
  return parseReviewConfigurationStrict({
    schemaVersion: 3,
    ...(input.contextTools === undefined
      ? {}
      : { contextTools: input.contextTools }),
    providers: [
      {
        kind: "codex",
        authMode,
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        agenticContext: input.agenticContext ?? true,
        fastMode: false,
        requiredHealthy: true,
        ...(authMode === "codex_account_gateway"
          ? {
              gatewayBindingId: "binding-1",
              gatewayProfileRef: "gateway-profile",
              ...(input.agentProfileRef
                ? { agentProfileRef: input.agentProfileRef }
                : {}),
            }
          : {}),
      },
    ],
    execution: {
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
    blockingPolicy: { failOnSeverity: "critical" },
    limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
    reviewLanguage: null,
    investigationRollout: {
      recordingEnabled: false,
      shadowEnabled: false,
      contextCriticEnabled: false,
      verifiedCleanEnabled: false,
      crossRevisionReplayEnabled: false,
      productionEffectsEnabled: false,
    },
  });
}
const effective = (
  input: Parameters<typeof config>[0] = {},
): EffectiveReviewConfiguration =>
  ({
    status: "ready",
    config: config(input),
  }) as EffectiveReviewConfiguration;

function fixture(
  input: {
    releases?: readonly ReturnType<typeof attestation>[];
    rows?: readonly PersistedRelease[];
    installed?: string | null;
    policy?: EffectiveReviewConfiguration;
    rawProfile?: string;
  } = {},
) {
  h.policies.mockResolvedValue({
    repositories: new Map([["repo-1", input.policy ?? effective()]]),
  });
  const prisma = {
    repositoryConnection: {
      findMany: vi
        .fn()
        .mockResolvedValue([{ id: "repo-1", fullName: "acme/private" }]),
    },
    workflowProvisioning: {
      findMany: vi.fn().mockResolvedValue([
        {
          repositoryId: "repo-1",
          installedWorkflowRequirement:
            input.installed === undefined ? "gateway" : input.installed,
        },
      ]),
    },
    producerRelease: { findMany: vi.fn().mockResolvedValue(input.rows ?? []) },
  };
  const env = {
    REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify(
      input.releases ?? [attestation()],
    ),
    ...(input.rawProfile === undefined
      ? {}
      : { REVIEW_ROUTER_AGENT_PROFILE: input.rawProfile }),
  };
  return {
    prisma,
    run: () =>
      readRepositorySkillsReadiness(
        { workspaceId: "workspace", repositoryIds: ["repo-1"] },
        { prisma: prisma as unknown as PrismaClient, env },
      ),
  };
}
describe("repository Skills support advisory", () => {
  beforeEach(() => vi.clearAllMocks());
  it("accepts valid materializable missing DB releases and returns only safe fields", async () => {
    const f = fixture();
    expect(await f.run()).toEqual([
      {
        repositoryId: "repo-1",
        name: "acme/private",
        status: "ready",
        reason: "supported",
      },
    ]);
    expect(f.prisma.producerRelease.findMany).toHaveBeenCalledTimes(1);
    expect(f.prisma.repositoryConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "workspace", id: { in: ["repo-1"] } },
      }),
    );
  });
  it("preserves explicit global defaults, supporting overrides and malformed raw values", async () => {
    expect(await fixture({ rawProfile: "codex-default" }).run()).toMatchObject([
      { status: "blocked", reason: "engine_unsupported" },
    ]);
    expect(
      await fixture({ rawProfile: "codex-skills-v1" }).run(),
    ).toMatchObject([{ status: "ready" }]);
    expect(
      await fixture({ rawProfile: "invalid/profile" }).run(),
    ).toMatchObject([{ status: "unknown" }]);
    expect(
      await fixture({
        rawProfile: "codex-default",
        policy: effective({ agentProfileRef: "codex-skills-v1" }),
      }).run(),
    ).toMatchObject([{ status: "ready" }]);
  });
  it("uses the actual supplied-diff and explicit engine selection", async () => {
    expect(
      await fixture({ policy: effective({ agenticContext: false }) }).run(),
    ).toMatchObject([{ status: "ready" }]);
    expect(
      await fixture({
        policy: effective({ agentProfileRef: "missing" }),
      }).run(),
    ).toMatchObject([{ status: "blocked", reason: "engine_unavailable" }]);
    expect(
      await fixture({
        policy: effective({
          agentProfileRef: "ocr-managed-v3",
          agenticContext: false,
        }),
      }).run(),
    ).toMatchObject([{ status: "blocked", reason: "engine_unavailable" }]);
  });
  it.each([
    {
      label: "OpenRouter",
      installed: "provider_api+openrouter",
      provider: {
        kind: "openrouter",
        authMode: "openrouter_api_key",
        model: "openai/gpt-5.3-codex",
        reasoningEffort: "high",
      },
    },
    {
      label: "MiMo",
      installed: "provider_api+codex-mimo",
      provider: {
        kind: "codex-mimo",
        authMode: "mimo_token_plan_api_key",
        model: "mimo-v2.6-pro",
        reasoningEffort: "high",
      },
    },
    {
      label: "Kimi",
      installed: "provider_api+kimi",
      provider: {
        kind: "kimi",
        authMode: "kimi_code_api_key",
        model: "k3-256k",
      },
    },
  ] as const)(
    "requires the canonical $label delivery seam and a supporting producer",
    async ({ provider, installed }) => {
      const direct = parseReviewConfigurationStrict({
        ...config(),
        providers: [
          {
            ...provider,
            agenticContext: true,
            fastMode: false,
            requiredHealthy: true,
          },
        ],
      });
      const policy = {
        status: "ready",
        config: direct,
      } as EffectiveReviewConfiguration;
      expect(await fixture({ policy, installed }).run()).toMatchObject([
        { status: "ready", reason: "supported" },
      ]);
      for (const stale of ["provider_api", "rotating"])
        expect(await fixture({ policy, installed: stale }).run()).toMatchObject(
          [{ status: "blocked", reason: "workflow_update_required" }],
        );
      expect(
        await fixture({
          policy,
          installed,
          releases: [attestation("a", [legacy])],
        }).run(),
      ).toMatchObject([{ status: "blocked", reason: "engine_unsupported" }]);
    },
  );
  it("does not advertise support for a saved MiMo policy with unsupported reasoning", async () => {
    const direct = parseReviewConfigurationStrict({
      ...config(),
      providers: [
        {
          kind: "codex-mimo",
          authMode: "mimo_token_plan_api_key",
          model: "mimo-v2.6-pro",
          reasoningEffort: "xhigh",
          agenticContext: true,
          fastMode: false,
          requiredHealthy: true,
        },
      ],
    });
    expect(
      await fixture({
        policy: {
          status: "ready",
          config: direct,
        } as EffectiveReviewConfiguration,
        installed: "provider_api+codex-mimo",
      }).run(),
    ).toMatchObject([{ status: "unknown", reason: "runtime_unconfirmed" }]);
  });
  it("keeps admission-incompatible context tool selections unconfirmed", async () => {
    const selections: NonNullable<ReviewConfiguration["contextTools"]>[] = [
      { version: 1, builtinTools: ["repository.docs.read"], mcp: [] },
      {
        version: 1,
        builtinTools: [],
        mcp: [{ connection: "docs", tools: ["read"] }],
      },
    ];
    const capability: ProducerContextToolsProfile = {
      extensionId: "context-tools.v1",
      descriptorDigest: contextToolsDescriptorDigest,
    };
    for (const contextTools of selections) {
      for (const policy of [
        effective({ agentProfileRef: supporting.profileRef, contextTools }),
        effective({ agenticContext: false, contextTools }),
      ])
        expect(
          await fixture({
            policy,
            releases: [attestation("a", undefined, capability)],
          }).run(),
        ).toMatchObject([{ status: "unknown", reason: "runtime_unconfirmed" }]);
      for (const agentProfileRef of [undefined, ocr.profileRef])
        expect(
          await fixture({
            policy: effective({
              ...(agentProfileRef === undefined ? {} : { agentProfileRef }),
              contextTools,
            }),
          }).run(),
        ).toMatchObject([{ status: "unknown", reason: "runtime_unconfirmed" }]);
      expect(
        await fixture({
          policy: effective({ contextTools }),
          releases: [
            attestation("a", undefined, {
              ...capability,
              descriptorDigest: `sha256:${"f".repeat(64)}`,
            }),
          ],
        }).run(),
      ).toMatchObject([{ status: "unknown", reason: "runtime_unconfirmed" }]);
      expect(
        await fixture({
          policy: effective({ contextTools }),
          releases: [attestation("a", undefined, capability)],
        }).run(),
      ).toMatchObject([{ status: "ready", reason: "supported" }]);
      expect(
        await fixture({
          policy: effective({ contextTools }),
          releases: [attestation("a", undefined, capability), attestation("d")],
        }).run(),
      ).toMatchObject([{ status: "unknown", reason: "runtime_unconfirmed" }]);
    }
  });
  it("does not require context tool capability for an empty selection", async () => {
    expect(
      await fixture({
        policy: effective({
          agentProfileRef: supporting.profileRef,
          contextTools: { version: 1, builtinTools: [], mcp: [] },
        }),
      }).run(),
    ).toMatchObject([{ status: "ready", reason: "supported" }]);
  });
  it("never takes a happy subset of mixed, missing-profile or ambiguous candidates", async () => {
    for (const second of [
      attestation("d", [legacy]),
      attestation("d", null),
      attestation("d", [legacy, ocr, { ...ocr, profileRef: "another-ocr" }]),
    ])
      expect(
        await fixture({ releases: [attestation(), second] }).run(),
      ).toMatchObject([{ status: "unknown" }]);
    expect(await fixture({ releases: [] }).run()).toMatchObject([
      { status: "unknown" },
    ]);
  });
  it("rejects self-asserted unsupported schema/canonicalizer pairs across all candidates", async () => {
    for (const modified of [
      { schemaDigest: "d".repeat(64), canonicalizerDigest: "e".repeat(64) },
      { canonicalizerDigest: "f".repeat(64) },
    ]) {
      expect(
        await fixture({ releases: [{ ...attestation(), ...modified }] }).run(),
      ).toMatchObject([{ status: "unknown" }]);
      expect(
        await fixture({
          releases: [attestation(), { ...attestation("d"), ...modified }],
        }).run(),
      ).toMatchObject([{ status: "unknown" }]);
    }
  });
  it("keeps revoked and immutable-mismatched registered releases unknown", async () => {
    for (const row of [
      { ...persisted(), state: "revoked", revokedAt: new Date() },
      { ...persisted(), runtimeEntrypointDigest: "f".repeat(64) },
    ])
      expect(
        await fixture({ rows: [row as PersistedRelease] }).run(),
      ).toMatchObject([{ status: "unknown" }]);
    expect(await fixture({ rows: [persisted()] }).run()).toMatchObject([
      { status: "ready" },
    ]);
  });
  it("shows saved policy and workflow issues without pretending to verify live setup", async () => {
    expect(
      await fixture({
        policy: effective({ authMode: "codex_subscription_oauth_rotating" }),
      }).run(),
    ).toMatchObject([{ status: "blocked", reason: "unsupported_workflow" }]);
    expect(await fixture({ installed: null }).run()).toMatchObject([
      { status: "unknown", reason: "workflow_unconfirmed" },
    ]);
    expect(await fixture({ installed: "rotating" }).run()).toMatchObject([
      { status: "blocked", reason: "workflow_update_required" },
    ]);
    expect(
      await fixture({
        policy: {
          status: "provider_selection_required",
          workspaceVersion: 1,
          repositoryVersion: null,
        },
      }).run(),
    ).toMatchObject([{ status: "blocked", reason: "configuration_required" }]);
    expect(
      await fixture({
        policy: {
          status: "resave_required",
          workspaceVersion: 1,
          repositoryVersion: null,
        },
      }).run(),
    ).toMatchObject([
      { status: "blocked", reason: "configuration_resave_required" },
    ]);
  });
  it("contains read errors and preserves scoped unknown results", async () => {
    const f = fixture();
    f.prisma.producerRelease.findMany.mockRejectedValue(
      new Error("private sentinel"),
    );
    expect(await f.run()).toEqual([
      {
        repositoryId: "repo-1",
        name: "acme/private",
        status: "unknown",
        reason: "runtime_unconfirmed",
      },
    ]);
    h.policies.mockRejectedValue(new Error("secret policy sentinel"));
    expect(JSON.stringify(await f.run())).not.toContain("sentinel");
  });
});
