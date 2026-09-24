import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  parseReviewActionV2Request,
  reviewActionV2Operations,
  reviewActionV2PublishedProtocolVersion,
  reviewActionV2PublishedSchemaDigest,
  reviewInvestigationExtensionV1,
  ReviewActionV2OperationId,
  type ReviewRunAuthorizeRequest,
} from "@reviewrouter/protocol-review-action-v2";
import { parseTrustedGitHubActionsOidcUrl } from "./hosted-codex-relay.js";
import { fetchHostedV4Json } from "./hosted-v4-http.js";

const authorizeOperation = reviewActionV2Operations.find(
  (operation) =>
    operation.operationId === ReviewActionV2OperationId.ReviewRunAuthorize,
)!;
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const nonempty = z.string().min(1);
const timestamp = z.iso.datetime({ offset: true });
const investigation = z.strictObject({
  authorizationDescriptorVersion: z.literal(3),
  capability: z.literal("review_investigation_v1"),
  coverageProfileHash: digest,
  extensionCanonicalizerDigest: z.literal(
    reviewInvestigationExtensionV1.canonicalizerDigest,
  ),
  extensionId: z.literal(reviewInvestigationExtensionV1.extensionId),
  extensionSchemaDigest: z.literal(reviewInvestigationExtensionV1.schemaDigest),
  policyHash: digest,
  providerCapabilities: z.array(
    z.strictObject({
      providerKind: z.enum(["codex", "claude_code"]),
      capabilities: z.array(z.string()),
    }),
  ),
});
const factsSchema = z.strictObject({
  workspaceId: nonempty,
  repositoryConnectionId: nonempty,
  scmRepositoryIdentityId: nonempty,
  pullRequestNumber: z.number().int().positive(),
  sourceRunId: nonempty,
  sourceRunAttempt: nonempty,
  baseSha: sha,
  mergeBaseSha: sha,
  headSha: sha,
  reviewRevisionHash: digest,
  producerReleaseId: nonempty,
  selectedProtocolVersion: z.literal(reviewActionV2PublishedProtocolVersion),
  schemaDigest: z.literal(reviewActionV2PublishedSchemaDigest),
  trustDomain: z.literal("trusted_managed"),
  providerVoteLanes: z
    .array(
      z.strictObject({
        providerKind: z.enum(["codex", "claude_code"]),
        providerVoteIdentityHash: digest,
      }),
    )
    .min(1),
  reviewInvestigation: investigation,
});
const protocolLimitsSchema = z.strictObject({
  maxWorkSlots: z.number().int().positive(),
  maxAttemptsPerSlot: z.number().int().positive(),
  maxObservationBytes: z.number().int().positive(),
  maxObservationFindings: z.number().int().positive(),
  maxProjectionBytes: z.number().int().positive(),
  maxProjectionFindings: z.number().int().positive(),
  maxPublicationOperations: z.number().int().positive(),
  maxPublicationChunks: z.number().int().positive(),
  maxPublicationBodyBytes: z.number().int().positive(),
  maxRequestBatchSize: z.number().int().positive(),
  maxLeaseDurationMs: z.number().int().positive(),
  maxResultReportDurationMs: z.number().int().positive(),
  maxReconciliationDurationMs: z.number().int().positive(),
});
const authorizeResponseSchema = z.strictObject({
  protocolVersion: z.literal(reviewActionV2PublishedProtocolVersion),
  schemaDigest: z.literal(reviewActionV2PublishedSchemaDigest),
  requestId: nonempty,
  serverTime: timestamp,
  result: z.strictObject({
    status: z.enum(["authorized", "restored"]),
    authorizationId: nonempty,
    authorizationToken: nonempty,
    producerReleaseId: nonempty,
    protocolLimitsProfileId: nonempty,
    operationalSloProfileId: nonempty,
    mutationEpoch: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
    expiresAt: timestamp,
    authorizationFactsCanonicalJson: nonempty,
    protocolLimitsCanonicalJson: nonempty,
  }),
});

export type HostedV4Authorization = Readonly<{
  authorizationId: string;
  authorizationToken: string;
  repositoryConnectionId: string;
  pullRequestNumber: number;
  headSha: string;
  reviewRevisionHash: string;
  producerReleaseId: string;
  expiresAt: string;
  /** v2 does not carry provider instance or pool binding in its result. */
  binding: { readonly kind: "server_binding_contract_gap" };
}>;

export type HostedV4AuthorizationInput = Readonly<{
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  apiUrl: string;
  oidcAudience: string;
  maskSecret: (secret: string) => void;
  expected: {
    readonly repositoryConnectionId: string;
    readonly pullRequestNumber: number;
    readonly headSha: string;
    readonly reviewRevisionHash: string;
    readonly producerReleaseId: string;
  };
  now?: () => Date;
}>;

/** A private, default-unused entry port. It never requests v1 fallback. */
export async function authorizeHostedV4WithFreshOidc(
  input: HostedV4AuthorizationInput,
): Promise<HostedV4Authorization> {
  const now = input.now ?? (() => new Date());
  const oidcUrl = input.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = input.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  try {
    if (!oidcUrl || !requestToken)
      throw new Error("hosted_v4_oidc_unavailable");
    if (!input.oidcAudience || input.oidcAudience.length > 256)
      throw new Error("hosted_v4_oidc_audience_invalid");
    input.maskSecret(requestToken);
    const url = parseTrustedGitHubActionsOidcUrl(oidcUrl);
    url.searchParams.set("audience", input.oidcAudience);
    const oidcResponse = await fetchHostedV4Json({
      fetchImpl: input.fetchImpl,
      url: url.toString(),
      init: {
        headers: { authorization: `bearer ${requestToken}` },
        redirect: "error",
      },
      acceptedStatuses: [200],
      timeoutMs: authorizeOperation.defaultTimeoutMs,
      maxBytes: 8 * 1024,
      errorPrefix: "hosted_v4_oidc",
    });
    const token = z
      .strictObject({ value: nonempty })
      .safeParse(oidcResponse.body);
    if (!token.success) throw new Error("hosted_v4_oidc_malformed");
    input.maskSecret(token.data.value);
    const requestId = `rr_hosted_v4_${randomUUID()}`;
    const request: ReviewRunAuthorizeRequest = {
      protocolVersion: reviewActionV2PublishedProtocolVersion,
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      requestId,
      oidcToken: token.data.value,
      supportedProtocols: [
        {
          protocolVersion: reviewActionV2PublishedProtocolVersion,
          schemaDigest: reviewActionV2PublishedSchemaDigest,
        },
      ],
    };
    if (
      !parseReviewActionV2Request(
        ReviewActionV2OperationId.ReviewRunAuthorize,
        request,
      ).ok
    )
      throw new Error("hosted_v4_authorize_request_invalid");
    const response = await fetchHostedV4Json({
      fetchImpl: input.fetchImpl,
      url: new URL(authorizeOperation.path, apiOrigin(input.apiUrl)).toString(),
      init: {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        redirect: "error",
        body: JSON.stringify(request),
      },
      acceptedStatuses: [200, 201],
      timeoutMs: authorizeOperation.defaultTimeoutMs,
      maxBytes: 128 * 1024,
      errorPrefix: "hosted_v4_authorize",
    });
    // The token is masked before any subsequent validation or rejection.
    const body = response.body;
    if (
      isRecord(body) &&
      isRecord(body.result) &&
      typeof body.result.authorizationToken === "string" &&
      body.result.authorizationToken
    )
      input.maskSecret(body.result.authorizationToken);
    const parsed = authorizeResponseSchema.safeParse(body);
    if (
      !parsed.success ||
      parsed.data.requestId !== requestId ||
      (response.status === 201 && parsed.data.result.status !== "authorized") ||
      (response.status === 200 && parsed.data.result.status !== "restored")
    )
      throw new Error("hosted_v4_authorize_malformed");
    const result = parsed.data.result;
    if (Date.parse(result.expiresAt) <= now().getTime())
      throw new Error("hosted_v4_authority_expired");
    let rawFacts: unknown;
    let rawLimits: unknown;
    try {
      rawFacts = JSON.parse(result.authorizationFactsCanonicalJson);
      rawLimits = JSON.parse(result.protocolLimitsCanonicalJson);
    } catch {
      throw new Error("hosted_v4_authorize_malformed");
    }
    const facts = factsSchema.safeParse(rawFacts);
    const limits = protocolLimitsSchema.safeParse(rawLimits);
    if (
      !facts.success ||
      !limits.success ||
      canonicalJson(rawFacts) !== result.authorizationFactsCanonicalJson ||
      canonicalJson(rawLimits) !== result.protocolLimitsCanonicalJson
    )
      throw new Error("hosted_v4_authorize_malformed");
    if (
      result.producerReleaseId !== facts.data.producerReleaseId ||
      facts.data.repositoryConnectionId !==
        input.expected.repositoryConnectionId ||
      facts.data.pullRequestNumber !== input.expected.pullRequestNumber ||
      facts.data.headSha !== input.expected.headSha ||
      facts.data.reviewRevisionHash !== input.expected.reviewRevisionHash ||
      facts.data.producerReleaseId !== input.expected.producerReleaseId ||
      !facts.data.reviewInvestigation.providerCapabilities.some(
        (row) =>
          row.providerKind === "codex" &&
          row.capabilities.includes("recording"),
      )
    )
      throw new Error("hosted_v4_authority_stale_or_unsupported");
    return {
      authorizationId: result.authorizationId,
      authorizationToken: result.authorizationToken,
      repositoryConnectionId: facts.data.repositoryConnectionId,
      pullRequestNumber: facts.data.pullRequestNumber,
      headSha: facts.data.headSha,
      reviewRevisionHash: facts.data.reviewRevisionHash,
      producerReleaseId: facts.data.producerReleaseId,
      expiresAt: result.expiresAt,
      binding: { kind: "server_binding_contract_gap" },
    };
  } finally {
    delete input.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    delete input.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  }
}

function apiOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("hosted_v4_api_url_invalid");
  return url;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
