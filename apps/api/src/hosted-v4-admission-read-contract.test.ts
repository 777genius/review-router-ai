import Fastify from "fastify";
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  defaultActionOidcAudience,
  githubActionsOidcIssuer,
  JoseGitHubActionsOidcTokenVerifier,
  type ActionControlPlaneRepositoryPort,
  type ActionRepositoryContext,
  type GitHubActionsOidcClaims,
} from "@reviewrouter/features-action-control-plane";
import { registerReviewRunControlV2Routes } from "@reviewrouter/features-action-control-plane/v2";
import { HostedV4AuthorityBridge } from "@reviewrouter/features-hosted-account-pool";
import { InvestigationRolloutCapability } from "@reviewrouter/features-review-investigation-operations";
import {
  ProducerDistributionKind,
  ProducerReleaseAttestationStatus,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  ReviewProviderKind,
  ReviewRunAuthorizationState,
  ReviewScmMergeBaseStatus,
  ReviewSafetyCapability,
  ReviewSafetyPolicyScope,
  ReviewSafetyRolloutMode,
  ScmProvider,
  canonicalJson,
  canonicalReviewOperationalSloProfile,
  canonicalReviewProtocolLimits,
  reviewInvestigationCapabilityV1,
} from "@reviewrouter/features-review-run-control";
import {
  createReviewRunControlTestKit,
  testAbsoluteProtocolMaxima,
} from "@reviewrouter/features-review-run-control/testing";
import {
  reviewActionV2GoldenFixtures,
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedSchemaDigest,
  reviewInvestigationExtensionV1,
} from "@reviewrouter/protocol-review-action-v2";
import { createHostedV4AuthoritySources } from "./hosted-v4-authority-sources.js";
import { registerHostedV4ReadRoutes } from "./hosted-v4-read-routes.js";
import { HostedV4ScmReadGateway } from "./github/hosted-v4-scm-read-gateway.js";
import {
  composeReviewActionV2RunControlRoutes,
  createServerOwnedReviewActionV2AdmissionFacts,
} from "./review-action-v2-run-control-composition.js";
import { createRepositoryReleaseSelector } from "./review-action-v2-repository-release-selection.js";
import { CanonicalGitHubReviewRevisionResolver } from "../../../packages/features/review-run-control/src/infrastructure/github/canonical-github-review-revision-resolver.js";
import { ConfiguredProducerReleaseAttestationRegistry } from "../../../packages/features/review-run-control/src/infrastructure/configured-producer-release-attestation.js";

const githubRequest = vi.hoisted(() => vi.fn());
vi.mock("@octokit/request", () => ({ request: githubRequest }));

const actionSha = "f".repeat(40);
const runtimeSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const mergeBaseSha = "d".repeat(40);
const headSha = "e".repeat(40);
const hash = (character: string) => character.repeat(64);
const readPath = "src/index.ts";
const fileBytes = Buffer.from("export const privateExample = 1;\n");

// This exercises the real v2 authorize route, v4 source adapter and bridge,
// and private v4 routes in one server. The test kit supplies in-memory
// persistence, signing keys and time; OIDC, repository and SCM facts are
// synthetic. Production codecs issue and check both signed tokens.
async function fixture() {
  const now = new Date(Math.floor(Date.now() / 1_000) * 1_000);
  const kit = createReviewRunControlTestKit({ now });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const verifier = new JoseGitHubActionsOidcTokenVerifier({
    jwks: async () => publicKey,
  });
  const repository: ActionRepositoryContext = {
    workspaceId: "workspace-1",
    repositoryId: "repository-1",
    githubRepositoryId: "123456",
    githubInstallationId: "98765",
    fullName: "777genius/example",
    owner: "777genius",
    selected: true,
    installationStatus: "active",
  };
  const actionRepositories: ActionControlPlaneRepositoryPort = {
    findSelectedRepositoryByGithubId: async (id) =>
      id === repository.githubRepositoryId ? repository : null,
    findRuntimeReviewConfiguration: async () => null,
    recordHealthReport: async () => {},
  };
  const identity =
    await kit.control.repositoryIdentities.resolveOrRegisterScmRepositoryIdentity(
      {
        provider: ScmProvider.GitHub,
        sourceBaseUrl: "https://github.com/",
        externalRepositoryId: repository.githubRepositoryId,
      },
    );
  const bound =
    await kit.control.repositoryIdentities.bindScmRepositoryIdentity({
      scmRepositoryIdentityId: identity.identity.scmRepositoryIdentityId,
      expectedVersion: identity.identity.version,
      workspaceId: repository.workspaceId,
      repositoryConnectionId: repository.repositoryId,
    });
  if (!("identity" in bound)) throw new Error("identity_bind_failed");
  const limits = {
    maxWorkSlots: 100,
    maxAttemptsPerSlot: 4,
    maxObservationBytes: 1_000_000,
    maxObservationFindings: 1_000,
    maxProjectionBytes: 2_000_000,
    maxProjectionFindings: 2_000,
    maxPublicationOperations: 500,
    maxPublicationChunks: 500,
    maxPublicationBodyBytes: 2_000_000,
    maxRequestBatchSize: 100,
    maxLeaseDurationMs: 600_000,
    maxResultReportDurationMs: 1_200_000,
    maxReconciliationDurationMs: 3_600_000,
  };
  const slos = {
    integrationEventDeliveryMs: 60_000,
    outboxClaimAgeMs: 120_000,
    missingCompletionProcessMs: 300_000,
    dueCompletionProcessMs: 300_000,
    publicationReconciliationMs: 600_000,
    v1DrainMs: 3_600_000,
    admissionMs: 30_000,
    pruningBacklogAgeMs: 86_400_000,
  };
  await kit.control.producerReleases.registerProtocolLimitsProfile({
    protocolLimitsProfileId: "limits-v4-contract",
    limitsDigest: await kit.digest.digestUtf8(
      canonicalReviewProtocolLimits(limits),
    ),
    limits,
  });
  await kit.control.producerReleases.registerOperationalSloProfile({
    operationalSloProfileId: "slo-v4-contract",
    sloDigest: await kit.digest.digestUtf8(
      canonicalReviewOperationalSloProfile({
        thresholds: slos,
        ownerRefs: ["team-reviewrouter"],
        runbookRefs: ["runbook/review-v2"],
      }),
    ),
    thresholds: slos,
    ownerRefs: ["team-reviewrouter"],
    runbookRefs: ["runbook/review-v2"],
  });
  const investigationProfile = {
    capability: reviewInvestigationCapabilityV1,
    coverageProfileHash: hash("5"),
    policyHash: hash("6"),
  } as const;
  await kit.control.producerReleases.registerProducerRelease({
    candidate: {
      producerReleaseId: "release-v4-contract",
      distributionKind: ProducerDistributionKind.PublicReusable,
      actionCommitSha: actionSha,
      runtimeCommitSha: runtimeSha,
      wrapperEntrypointDigest: null,
      runtimeEntrypointDigest: hash("7"),
      contextGatewayPolicyVersion: "review-context-gateway.v1",
      contextGatewayEntrypointDigest: hash("8"),
      reviewInvestigationProfile: investigationProfile,
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
      protocolLimitsProfileId: "limits-v4-contract",
      operationalSloProfileId: "slo-v4-contract",
    },
    expectedProtocolLimitsDigest: await kit.digest.digestUtf8(
      canonicalReviewProtocolLimits(limits),
    ),
    expectedOperationalSloDigest: await kit.digest.digestUtf8(
      canonicalReviewOperationalSloProfile({
        thresholds: slos,
        ownerRefs: ["team-reviewrouter"],
        runbookRefs: ["runbook/review-v2"],
      }),
    ),
  });
  await kit.control.mutationAuthority.initialize({
    scmRepositoryIdentityId: identity.identity.scmRepositoryIdentityId,
  });
  await kit.control.safetyControls.setReviewSafetyEmergencyStop({
    expectedVersion: 0,
    scope: { scope: ReviewSafetyPolicyScope.Global },
    stopped: false,
    reason: "test-enabled",
    updatedBy: "test-operator",
  });
  await kit.control.safetyControls.updateReviewSafetyPolicy({
    expectedVersion: 0,
    scope: { scope: ReviewSafetyPolicyScope.Global },
    capability: ReviewSafetyCapability.RunAuthorizationV2,
    rolloutMode: ReviewSafetyRolloutMode.Enabled,
    updatedBy: "test-operator",
  });

  const revisionHashes = {
    digest: async (input: {
      workspaceId: string;
      repositoryConnectionId: string;
      scmRepositoryIdentityId: string;
      pullRequestNumber: number;
      baseSha: string;
      mergeBaseSha: string;
      headSha: string;
    }) => kit.digest.digestUtf8(canonicalJson(input)),
  };
  const revisionHash = await revisionHashes.digest({
    workspaceId: repository.workspaceId,
    repositoryConnectionId: repository.repositoryId,
    scmRepositoryIdentityId: identity.identity.scmRepositoryIdentityId,
    pullRequestNumber: 42,
    baseSha,
    mergeBaseSha,
    headSha,
  });
  const release = await kit.store.findProducerReleaseById(
    "release-v4-contract",
  );
  if (!release) throw new Error("release_registration_failed");
  let selectedHead = headSha;
  let selectedMergeBase = mergeBaseSha;
  let selectedActionSha = actionSha;
  const releaseAttestations = new ConfiguredProducerReleaseAttestationRegistry(
    [
      {
        producerReleaseId: release.producerReleaseId,
        distributionKind: ProducerDistributionKind.PublicReusable,
        actionCommitSha: actionSha,
        runtimeCommitSha: runtimeSha,
        wrapperEntrypointDigest: null,
        runtimeEntrypointDigest: hash("7"),
        contextGatewayPolicyVersion: "review-context-gateway.v1",
        contextGatewayEntrypointDigest: hash("8"),
        reviewInvestigationProfile: investigationProfile,
        schemaDigest: reviewActionV2PublishedSchemaDigest,
        canonicalizerDigest: reviewActionV2CanonicalizerDigest,
        capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
        protocolLimitsProfileId: "limits-v4-contract",
        operationalSloProfileId: "slo-v4-contract",
      },
    ],
    kit.store,
  );
  const revisionResolver = new CanonicalGitHubReviewRevisionResolver(
    {
      findPullRequestNumbersForRun: async () => [42],
      loadPullRequestPointer: async () => ({
        pullRequestNumber: 42,
        baseSha,
        headSha: selectedHead,
      }),
      resolveOfficialMergeBase: async () => ({
        status: ReviewScmMergeBaseStatus.Resolved,
        mergeBaseSha: selectedMergeBase,
      }),
    },
    kit.digest,
  );
  const admissionFacts = createServerOwnedReviewActionV2AdmissionFacts({
    revisionResolver,
    releaseAttestations,
    providerVoteLanes: [
      {
        providerKind: ReviewProviderKind.Codex,
        providerVoteIdentityHash: hash("4"),
      },
    ],
  });
  const handlers = composeReviewActionV2RunControlRoutes({
    enabled: true,
    runtime: {
      readServerTime: async () => kit.clock.now(),
      createRequestId: () => "server-v4-contract",
    },
    handlers: {
      oidcVerifier: verifier,
      oidcAudience: defaultActionOidcAudience,
      actionRepositories,
      repositoryIdentities: kit.store,
      producerReleases: kit.store,
      admissionFacts,
      revisionHashes,
      authorizations: kit.control.authorizations,
      digest: kit.digest,
      absoluteProtocolMaxima: testAbsoluteProtocolMaxima,
      authorizationTtlMs: 10 * 60_000,
      maxAuthorizationLifetimeMs: 60 * 60_000,
      reviewInvestigationCapability: {
        resolve: async () => ({
          ...investigationProfile,
          authorizationDescriptorVersion: 3,
          extensionCanonicalizerDigest:
            reviewInvestigationExtensionV1.canonicalizerDigest,
          extensionId: reviewInvestigationExtensionV1.extensionId,
          extensionSchemaDigest: reviewInvestigationExtensionV1.schemaDigest,
          providerCapabilities: [
            {
              providerKind: "codex",
              capabilities: [InvestigationRolloutCapability.Recording],
            },
          ],
        }),
      },
    },
  });

  let bindingStatus = "active";
  const repoRow = () => ({
    id: repository.repositoryId,
    workspaceId: repository.workspaceId,
    provider: "github",
    scmRepositoryIdentityId: identity.identity.scmRepositoryIdentityId,
    githubRepositoryId: 123456n,
    owner: "777genius",
    name: "example",
    selected: true,
    archived: false,
    installation: {
      githubInstallationId: 98765n,
      status: "active",
      workspaceId: repository.workspaceId,
    },
    hostedCodexBindings: [
      {
        id: "binding-v4-contract",
        revision: 2n,
        status: bindingStatus,
        attestedGithubRepositoryId: 123456n,
        attestedBindingRevision: 2n,
        workflowPath: ".github/workflows/reviewrouter-codex.yml",
        workflowActionRef: `777genius/review-router@${selectedActionSha}`,
        workflowSourceCommitSha: "a".repeat(40),
        workflowSourceBlobSha: "b".repeat(40),
        workflowSourceSha256: hash("c"),
        workflowSemanticSha256: hash("d"),
        workflowSourceTrust: "trusted_default_branch_revision",
        pool: { status: "active" },
      },
    ],
  });
  githubRequest.mockReset();
  githubRequest.mockImplementation(async (route: string) => {
    switch (route) {
      case "GET /repos/{owner}/{repo}":
        return { data: { id: 123456 } };
      case "GET /repos/{owner}/{repo}/pulls/{pull_number}":
        return {
          data: {
            number: 42,
            state: "open",
            base: { sha: baseSha, repo: { id: 123456 } },
            head: { sha: selectedHead },
          },
        };
      case "GET /repos/{owner}/{repo}/compare/{basehead}":
        return { data: { merge_base_commit: { sha: selectedMergeBase } } };
      case "GET /repos/{owner}/{repo}/contents/{path}":
        return {
          data: {
            type: "file",
            encoding: "base64",
            content: fileBytes.toString("base64"),
            sha: "a".repeat(40),
            size: fileBytes.length,
          },
        };
      default:
        throw new Error(`unexpected_scm_route:${route}`);
    }
  });
  const issueContentsReadToken = vi.fn(async () => ({
    token: "synthetic-server-only-scm-bearer",
    expiresAt: new Date(kit.clock.now().getTime() + 60_000),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  const scm = new HostedV4ScmReadGateway({ issueContentsReadToken }, () =>
    kit.clock.now(),
  );
  const scmRevision = vi.spyOn(scm, "readCanonicalRevision");
  const scmRead = vi.spyOn(scm, "readFile");
  const releaseSelector = createRepositoryReleaseSelector(undefined, kit.store);
  const sources = createHostedV4AuthoritySources({
    prisma: {
      repositoryConnection: { findUnique: async () => repoRow() },
    } as never,
    authorizations: kit.control.authorizations,
    authorizationQueries: kit.store,
    releases: kit.store,
    scm,
    currentProducerReleaseId: async (authorization, sha) => {
      const attested = await releaseAttestations.attest({
        actionCommitSha: sha,
        expectedSchemaDigest: reviewActionV2PublishedSchemaDigest,
        expectedCanonicalizerDigest: reviewActionV2CanonicalizerDigest,
      });
      if (
        attested.status !== ProducerReleaseAttestationStatus.Attested ||
        attested.release.state !== ProducerReleaseState.Registered
      )
        return null;
      const selected = await releaseSelector.select({
        workspaceId: authorization.workspaceId,
        repositoryConnectionId: authorization.repositoryConnectionId,
        scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
        actionCommitSha: sha,
        baseRelease: attested.release,
      });
      return selected.state === ProducerReleaseState.Registered &&
        selected.actionCommitSha === sha
        ? selected.producerReleaseId
        : null;
    },
  });
  const bridge = new HostedV4AuthorityBridge(sources, Buffer.alloc(32, 9), () =>
    kit.clock.now(),
  );
  const app = Fastify();
  await registerReviewRunControlV2Routes(app, handlers);
  await registerHostedV4ReadRoutes(app, {
    enabled: true,
    bridge,
    scm,
  });
  const claims = (jti: string): GitHubActionsOidcClaims => ({
    iss: githubActionsOidcIssuer,
    aud: defaultActionOidcAudience,
    sub: "repo:777genius/example:pull_request",
    repository: "777genius/example",
    repository_id: "123456",
    repository_owner: "777genius",
    event_name: "pull_request",
    run_id: "1001",
    run_attempt: "1",
    workflow_ref:
      "777genius/example/.github/workflows/reviewrouter-codex.yml@refs/pull/42/merge",
    workflow_sha: headSha,
    job_workflow_ref: `777genius/review-router/.github/workflows/reviewrouter-execution-reusable.yml@${actionSha}`,
    job_workflow_sha: actionSha,
    actor: "777genius",
    jti,
    exp: Math.floor(now.getTime() / 1000) + 3600,
  });
  async function oidc(overrides: Record<string, unknown> = {}) {
    return new SignJWT({ ...claims("v4-contract-jti"), ...overrides } as Record<
      string,
      unknown
    >)
      .setProtectedHeader({ alg: "RS256" })
      .sign(privateKey);
  }
  async function authorize(token: string, requestId = "v4-contract-authorize") {
    return app.inject({
      method: "POST",
      url: "/api/action/v2/review-runs/authorize",
      payload: {
        ...reviewActionV2GoldenFixtures.review_run_authorize.request,
        requestId,
        oidcToken: token,
      },
    });
  }
  const admission = (authorizationToken: string) => ({
    authorizationToken,
    repositoryConnectionId: repository.repositoryId,
    providerInstanceId: "hosted-pool:repository:123456",
    bindingId: "binding-v4-contract",
    bindingVersion: 2,
  });
  const contentRequests = () =>
    githubRequest.mock.calls.filter(
      ([route]) => route === "GET /repos/{owner}/{repo}/contents/{path}",
    ).length;
  return {
    app,
    kit,
    revisionHash,
    oidc,
    authorize,
    admission,
    scmRead,
    scmRevision,
    githubRequest,
    issueContentsReadToken,
    contentRequests,
    setBindingStatus: (value: string) => {
      bindingStatus = value;
    },
    setReleaseSha: (value: string) => {
      selectedActionSha = value;
    },
    setHead: (value: string) => {
      selectedHead = value;
    },
    setMergeBase: (value: string) => {
      selectedMergeBase = value;
    },
  };
}

describe("hosted v4 real private admission and read wire contract", () => {
  it("authorizes, reads, refreshes and rereads; live authority changes deny before SCM bytes", async () => {
    const f = await fixture();
    try {
      const authorized = await f.authorize(await f.oidc());
      expect(authorized.statusCode).toBe(201);
      const result = authorized.json().result;
      expect(result).toMatchObject({
        status: "authorized",
        authorizationId: expect.any(String),
        authorizationToken: expect.any(String),
        producerReleaseId: "release-v4-contract",
      });
      expect(JSON.parse(result.authorizationFactsCanonicalJson)).toMatchObject({
        headSha,
        reviewRevisionHash: f.revisionHash,
        reviewInvestigation: {
          providerCapabilities: [
            { providerKind: "codex", capabilities: ["recording"] },
          ],
        },
      });
      const admitted = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(result.authorizationToken),
      });
      expect(admitted.statusCode).toBe(201);
      expect(admitted.headers["cache-control"]).toBe("no-store");
      const capability = admitted.json().capability as string;
      const originalExpiry = Date.parse(admitted.json().expiresAt);
      const authorizationExpiry = Date.parse(result.expiresAt);
      expect(originalExpiry).toBeGreaterThan(f.kit.clock.now().getTime());
      expect(originalExpiry).toBeLessThan(authorizationExpiry);
      expect(capability).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
      const read = (cap: string, path = readPath) =>
        f.app.inject({
          method: "POST",
          url: "/api/hosted/v4/files/read",
          payload: { capability: cap, path },
        });
      const first = await read(capability);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({
        path: readPath,
        headSha,
        blobSha: "a".repeat(40),
        contentBase64: fileBytes.toString("base64"),
      });
      expect(first.body).not.toContain("synthetic-server-only-scm-bearer");
      expect(f.githubRequest).toHaveBeenCalledWith(
        "GET /repos/{owner}/{repo}/contents/{path}",
        expect.objectContaining({ path: readPath, ref: headSha }),
      );
      f.kit.clock.set(new Date(originalExpiry - 60_000));
      const refreshed = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities/refresh",
        payload: { capability, authorizationToken: result.authorizationToken },
      });
      expect(refreshed.statusCode).toBe(200);
      const renewedCapability = refreshed.json().capability as string;
      const renewedExpiry = Date.parse(refreshed.json().expiresAt);
      expect(renewedExpiry).toBeGreaterThan(originalExpiry);
      expect(renewedExpiry).toBeLessThanOrEqual(authorizationExpiry);
      expect(renewedCapability).not.toBe(capability);
      expect((await read(renewedCapability)).statusCode).toBe(200);
      f.kit.clock.set(new Date(originalExpiry));
      expect(f.kit.clock.now().getTime()).toBeLessThan(renewedExpiry);
      expect((await read(capability)).statusCode).toBe(403);
      expect((await read(renewedCapability)).statusCode).toBe(200);
      expect(f.scmRead).toHaveBeenCalledTimes(3);
      expect(f.contentRequests()).toBe(3);

      for (const changed of [
        () => f.setBindingStatus("revoked"),
        () => {
          f.setBindingStatus("active");
          f.setReleaseSha("0".repeat(40));
        },
        () => {
          f.setReleaseSha(actionSha);
          f.setHead("0".repeat(40));
        },
        () => {
          f.setHead(headSha);
          f.setMergeBase("0".repeat(40));
        },
      ]) {
        changed();
        const before = f.scmRead.mock.calls.length;
        const beforeContent = f.contentRequests();
        expect((await read(renewedCapability)).statusCode).toBe(403);
        expect(
          (
            await f.app.inject({
              method: "POST",
              url: "/api/hosted/v4/read-capabilities/refresh",
              payload: {
                capability: renewedCapability,
                authorizationToken: result.authorizationToken,
              },
            })
          ).statusCode,
        ).toBe(403);
        expect(f.scmRead).toHaveBeenCalledTimes(before);
        expect(f.contentRequests()).toBe(beforeContent);
      }
      f.setMergeBase(mergeBaseSha);
      await f.kit.control.authorizations.expireOrRevokeReviewRunAuthorization({
        authorizationId: result.authorizationId,
        state: ReviewRunAuthorizationState.Revoked,
      });
      const before = f.scmRead.mock.calls.length;
      const beforeContent = f.contentRequests();
      expect((await read(renewedCapability)).statusCode).toBe(403);
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/hosted/v4/read-capabilities/refresh",
            payload: {
              capability: renewedCapability,
              authorizationToken: result.authorizationToken,
            },
          })
        ).statusCode,
      ).toBe(403);
      expect(f.scmRead).toHaveBeenCalledTimes(before);
      expect(f.contentRequests()).toBe(beforeContent);
    } finally {
      await f.app.close();
    }
  });

  it("denies issuer, audience, replay, bad admission and malformed reads without SCM access", async () => {
    const f = await fixture();
    try {
      for (const claims of [
        { iss: "https://issuer.invalid" },
        { aud: "wrong-audience" },
      ]) {
        const denied = await f.authorize(
          await f.oidc(claims),
          `bad-${Object.keys(claims)[0]}`,
        );
        expect(denied.statusCode).toBe(403);
      }
      expect(f.issueContentsReadToken).not.toHaveBeenCalled();
      expect(f.githubRequest).not.toHaveBeenCalled();
      const validToken = await f.oidc();
      const authorized = await f.authorize(validToken);
      expect(authorized.statusCode).toBe(201);
      const replay = await f.authorize(
        await f.oidc({ run_attempt: "2" }),
        "different-request-id",
      );
      expect(replay.statusCode).toBe(409);
      const token = authorized.json().result.authorizationToken as string;
      for (const payload of [
        { ...f.admission(token), bindingVersion: 3 },
        {
          ...f.admission(token),
          providerInstanceId: "hosted-pool:repository:999",
        },
        { ...f.admission(token), unexpected: true },
      ]) {
        const denied = await f.app.inject({
          method: "POST",
          url: "/api/hosted/v4/read-capabilities",
          payload,
        });
        expect([400, 403]).toContain(denied.statusCode);
      }
      const malformed = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/files/read",
        payload: { capability: "malformed", path: readPath },
      });
      expect(malformed.statusCode).toBe(403);
      const invalidRead = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/files/read",
        payload: { capability: "malformed", path: readPath, extra: true },
      });
      expect(invalidRead.statusCode).toBe(400);
      const invalidRefresh = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities/refresh",
        payload: {
          capability: "malformed",
          authorizationToken: token,
          extra: true,
        },
      });
      expect(invalidRefresh.statusCode).toBe(400);
      expect(f.scmRead).not.toHaveBeenCalled();
      expect(f.contentRequests()).toBe(0);
    } finally {
      await f.app.close();
    }
  });

  it("expires the capability while its authorization is still active", async () => {
    const f = await fixture();
    try {
      const authorized = await f.authorize(await f.oidc());
      expect(authorized.statusCode).toBe(201);
      const token = authorized.json().result.authorizationToken as string;
      const admitted = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(admitted.statusCode).toBe(201);
      const capability = admitted.json().capability as string;
      const capabilityExpiry = Date.parse(admitted.json().expiresAt);
      const authorizationExpiry = Date.parse(
        authorized.json().result.expiresAt,
      );
      expect(capabilityExpiry).toBeLessThan(authorizationExpiry);
      f.kit.clock.set(new Date(capabilityExpiry));
      expect(f.kit.clock.now().getTime()).toBeLessThan(authorizationExpiry);
      const read = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/files/read",
        payload: { capability, path: readPath },
      });
      expect(read.statusCode).toBe(403);
      const refresh = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities/refresh",
        payload: { capability, authorizationToken: token },
      });
      expect(refresh.statusCode).toBe(403);
      expect(f.scmRead).not.toHaveBeenCalled();
      expect(f.contentRequests()).toBe(0);
      const stillAuthorized = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(stillAuthorized.statusCode).toBe(201);
      expect(Date.parse(stillAuthorized.json().expiresAt)).toBeGreaterThan(
        capabilityExpiry,
      );
    } finally {
      await f.app.close();
    }
  });

  it("denies admission, read and refresh when authorization expires before the capability", async () => {
    const f = await fixture();
    try {
      const authorized = await f.authorize(await f.oidc());
      expect(authorized.statusCode).toBe(201);
      const token = authorized.json().result.authorizationToken as string;
      const admitted = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(admitted.statusCode).toBe(201);
      const capability = admitted.json().capability as string;
      const authorizationExpiry = Date.parse(
        authorized.json().result.expiresAt,
      );
      const capabilityExpiry = Date.parse(admitted.json().expiresAt);
      expect(capabilityExpiry).toBeLessThan(authorizationExpiry);
      f.kit.clock.advance(60_000);
      expect(f.kit.clock.now().getTime()).toBeLessThan(capabilityExpiry);
      const beforeExpiry = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/files/read",
        payload: { capability, path: readPath },
      });
      expect(beforeExpiry.statusCode).toBe(200);
      const expired =
        await f.kit.control.authorizations.expireOrRevokeReviewRunAuthorization(
          {
            authorizationId: authorized.json().result.authorizationId,
            state: ReviewRunAuthorizationState.Expired,
          },
        );
      expect(expired.status).toBe("terminated");
      expect(f.kit.clock.now().getTime()).toBeLessThan(capabilityExpiry);
      const beforeContent = f.contentRequests();
      const beforeScmRead = f.scmRead.mock.calls.length;
      const expiredAdmission = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(expiredAdmission.statusCode).toBe(403);
      const expiredRead = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/files/read",
        payload: { capability, path: readPath },
      });
      expect(expiredRead.statusCode).toBe(403);
      const expiredRefresh = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities/refresh",
        payload: { capability, authorizationToken: token },
      });
      expect(expiredRefresh.statusCode).toBe(403);
      expect(f.scmRead).toHaveBeenCalledTimes(beforeScmRead);
      expect(f.contentRequests()).toBe(beforeContent);
    } finally {
      await f.app.close();
    }
  });

  it("denies a new admission at the authorization lifetime boundary", async () => {
    const f = await fixture();
    try {
      const authorized = await f.authorize(await f.oidc());
      expect(authorized.statusCode).toBe(201);
      const token = authorized.json().result.authorizationToken as string;
      const admitted = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(admitted.statusCode).toBe(201);
      const authorizationExpiry = Date.parse(
        authorized.json().result.expiresAt,
      );
      expect(Date.parse(admitted.json().expiresAt)).toBeLessThan(
        authorizationExpiry,
      );
      f.kit.clock.set(new Date(authorizationExpiry));
      const expiredAdmission = await f.app.inject({
        method: "POST",
        url: "/api/hosted/v4/read-capabilities",
        payload: f.admission(token),
      });
      expect(expiredAdmission.statusCode).toBe(403);
      expect(f.scmRead).not.toHaveBeenCalled();
      expect(f.contentRequests()).toBe(0);
    } finally {
      await f.app.close();
    }
  });
});
