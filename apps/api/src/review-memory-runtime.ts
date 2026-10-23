import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  type MemoryActor,
  type MemoryKnowledgeAdmissionReceipt,
  type MemoryKnowledgeBundleItem,
  type MemoryKnowledgeScope,
  type MemoryPolicyConfig,
  type MemoryRequestControls,
} from "@reviewrouter/features-memory";
import {
  approvedMemorySourceApplicable,
  PrismaMemoryKnowledgeAccess,
  PrismaMemoryPermission,
} from "@reviewrouter/features-memory/infrastructure";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import {
  reviewMemoryBinding,
  reviewMemorySnapshotHash,
  type ReviewMemoryBinding,
  type ReviewMemoryBundle,
  type ReviewMemoryItem,
} from "./review-memory-wire.js";

const identifier = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const bindingSchema = z.object({
  protocolVersion: z.literal(2),
  authorizationId: identifier,
  repositoryConnectionId: identifier,
  pullRequestNumber: z.number().int().positive(),
  baseSha: commit,
  headSha: commit,
  reviewRevisionHash: hash,
});
const bundleSchema = bindingSchema.strict();
const admitSchema = bindingSchema
  .extend({
    bundleId: identifier,
    eligibilityEpoch: identifier,
    policyVersion: identifier,
    providerGeneration: identifier,
  })
  .strict();

export function reviewMemoryRuntimeScopes(
  authorization: Pick<
    ReviewRunAuthorization,
    "workspaceId" | "repositoryConnectionId"
  > & { readonly trustDomain: `${ReviewRunAuthorization["trustDomain"]}` },
  policy: MemoryPolicyConfig,
): readonly MemoryKnowledgeScope[] {
  if (!policy.memoryEnabled) return [];
  const fork = authorization.trustDomain === "untrusted_contribution";
  if (fork && policy.forkPullRequestMode === "disabled") return [];
  const scopes: MemoryKnowledgeScope[] = [];
  if (
    policy.allowedScopes.workspace &&
    (!fork || policy.forkPullRequestMode === "workspace_without_user_prefs")
  ) {
    scopes.push({ kind: "workspace", workspaceId: authorization.workspaceId });
  }
  if (policy.allowedScopes.repository) {
    scopes.push({
      kind: "repository",
      workspaceId: authorization.workspaceId,
      repositoryId: authorization.repositoryConnectionId,
    });
  }
  return scopes;
}

export class ReviewMemoryRuntimeGateway {
  constructor(
    private readonly dependencies: {
      readonly prisma: PrismaClient;
      readonly runtime: MemoryKnowledgeRuntime;
      readonly access: {
        authorize(token: string): Promise<ReviewRunAuthorization | null>;
      };
      readonly now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private async capture(
    token: string,
    binding: ReviewMemoryBinding,
  ): Promise<ReviewRunAuthorization> {
    const authorization = await this.dependencies.access.authorize(token);
    if (
      !authorization ||
      memoryKnowledgeDigest(reviewMemoryBinding(authorization)) !==
        memoryKnowledgeDigest(reviewMemoryBinding(binding))
    ) {
      throw new MemoryKnowledgeError("forbidden");
    }
    return authorization;
  }

  private service(
    authorization: ReviewRunAuthorization,
    scopes: readonly MemoryKnowledgeScope[],
  ) {
    const actor: MemoryActor = {
      kind: "system",
      id: `review:${authorization.authorizationId}`,
      githubUserId: null,
      login: null,
    };
    const access = new PrismaMemoryKnowledgeAccess({
      prisma: this.dependencies.prisma,
      permissions: new PrismaMemoryPermission(this.dependencies.prisma),
      policy: this.dependencies.runtime.policy,
      runtimeGrant: {
        actorId: actor.id,
        scopes,
        headSha: authorization.headSha,
      },
      sourceAuthority: {
        verifySource: async () => {
          throw new MemoryKnowledgeError("forbidden");
        },
        sourceApplicable: approvedMemorySourceApplicable,
      },
      now: () => this.now(),
    });
    return { actor, service: this.dependencies.runtime.forAccess(access) };
  }

  async bundle(
    token: string,
    input: z.infer<typeof bundleSchema>,
    controls: MemoryRequestControls,
  ): Promise<ReviewMemoryBundle> {
    const authorization = await this.capture(token, input);
    const policy = await this.dependencies.runtime.policy.getPolicy({
      workspaceId: authorization.workspaceId,
      repositoryId: authorization.repositoryConnectionId,
    });
    const scopes = this.dependencies.runtime.enabled
      ? reviewMemoryRuntimeScopes(authorization, policy)
      : [];
    const { actor, service } = this.service(authorization, scopes);
    // The qualified profile exports approved statements only. A customer-supplied
    // query could contain raw source even after secret/code pattern filtering.
    const query =
      "Approved repository review conventions and maintained project knowledge";
    checkDeadline(controls);
    const bundle = await service.bundle(
      { actor, scopes, query, limitPerScope: 6 },
      controls,
    );
    const current = await this.capture(token, input);
    if (
      current.mutationEpoch !== authorization.mutationEpoch ||
      current.runtimeSnapshotCanonicalJson !==
        authorization.runtimeSnapshotCanonicalJson
    ) {
      throw new MemoryKnowledgeError("conflict");
    }
    checkDeadline(controls);
    const receipt = service.createBundleReceipt(bundle);
    const wire: ReviewMemoryBundle = {
      protocolVersion: 2,
      ...reviewMemoryBinding(input),
      bundleId: randomUUID(),
      policyVersion: String(policy.policyVersion),
      providerGeneration: bundle.generation,
      eligibilityEpoch: memoryKnowledgeDigest(
        receipt.scopes.map(({ scope, epoch }) => ({ scope, epoch })),
      ),
      expiresAt: bundle.expiresAt,
      items: bundle.scopes
        .flatMap(({ scope, items }) =>
          items.flatMap((item) => {
            const mapped = wireItem(item, scope);
            return mapped ? [mapped] : [];
          }),
        )
        .slice(0, 12),
      degraded: bundle.degraded,
      reason: bundle.degraded
        ? "memory_unavailable"
        : scopes.length === 0
          ? "memory_disabled"
          : null,
    };
    if (wire.items.length > 0) {
      await this.dependencies.prisma.memoryKnowledgeBundleReceipt.create({
        data: {
          id: wire.bundleId,
          authorizationId: authorization.authorizationId,
          bindingDigest: memoryKnowledgeDigest(reviewMemoryBinding(input)),
          workspaceId: authorization.workspaceId,
          receipt: receipt as unknown as Prisma.InputJsonValue,
          snapshotHash: reviewMemorySnapshotHash(wire),
          policyVersion: policy.policyVersion,
          eligibilityEpoch: wire.eligibilityEpoch,
          expiresAt: new Date(wire.expiresAt),
        },
      });
    }
    checkDeadline(controls);
    return wire;
  }

  async admit(
    token: string,
    input: z.infer<typeof admitSchema>,
    controls: MemoryRequestControls,
  ): Promise<boolean> {
    const authorization = await this.capture(token, input);
    const row =
      await this.dependencies.prisma.memoryKnowledgeBundleReceipt.findUnique({
        where: { id: input.bundleId },
      });
    if (
      !row ||
      !this.dependencies.runtime.enabled ||
      row.authorizationId !== authorization.authorizationId ||
      row.workspaceId !== authorization.workspaceId ||
      row.bindingDigest !== memoryKnowledgeDigest(reviewMemoryBinding(input)) ||
      row.eligibilityEpoch !== input.eligibilityEpoch ||
      String(row.policyVersion) !== input.policyVersion ||
      row.expiresAt <= this.now() ||
      input.providerGeneration !== this.dependencies.runtime.generation
    )
      return false;
    const policy = await this.dependencies.runtime.policy.getPolicy({
      workspaceId: authorization.workspaceId,
      repositoryId: authorization.repositoryConnectionId,
    });
    if (policy.policyVersion !== row.policyVersion) return false;
    const { actor, service } = this.service(
      authorization,
      reviewMemoryRuntimeScopes(authorization, policy),
    );
    checkDeadline(controls);
    const eligible = await service.admitReceipt(
      {
        actor,
        receipt: row.receipt as unknown as MemoryKnowledgeAdmissionReceipt,
      },
      controls,
    );
    const current = await this.capture(token, input);
    return (
      eligible &&
      current.mutationEpoch === authorization.mutationEpoch &&
      current.runtimeSnapshotCanonicalJson ===
        authorization.runtimeSnapshotCanonicalJson
    );
  }
}

function checkDeadline(controls: MemoryRequestControls): void {
  if (controls.signal?.aborted || Date.now() >= controls.deadlineAt.getTime())
    throw new MemoryKnowledgeError("deadline_exceeded", true);
}

async function withinDeadline<T>(
  controls: MemoryRequestControls,
  work: () => Promise<T>,
): Promise<T> {
  checkDeadline(controls);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new MemoryKnowledgeError("deadline_exceeded", true)),
          Math.max(0, controls.deadlineAt.getTime() - Date.now()),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function wireItem(
  item: MemoryKnowledgeBundleItem,
  scope: MemoryKnowledgeScope,
): ReviewMemoryItem | null {
  if (scope.kind === "user_preference") return null;
  if (item.type === "observation") {
    if (
      !item.evidenceComplete ||
      item.sourceMetadata.length === 0 ||
      item.sourceMetadata.length > 32
    )
      return null;
    const sources = item.sourceMetadata;
    if (
      sources.some(
        (source) => !source.originalStatementAt || !source.lastVerifiedAt,
      )
    )
      return null;
    return {
      id: item.ref.observationId,
      scope: scope.kind,
      kind: "observation",
      body: item.body,
      revision: memoryKnowledgeDigest(
        sources.map((source) => [source.ref, source.revision]),
      ),
      sourceIds: sources.map((source) => source.ref.entryId),
      temporalStatus: "historical",
      statementAt: sources
        .map((source) => source.originalStatementAt!)
        .sort()[0]!,
      lastVerifiedAt: sources
        .map((source) => source.lastVerifiedAt!)
        .sort()[0]!,
    };
  }
  const metadata = item.metadata;
  if (!metadata.originalStatementAt || !metadata.lastVerifiedAt) return null;
  const observedCommitSha = metadata.applicability.observedCommitSha;
  if (metadata.kind === "observation" && !observedCommitSha) return null;
  if (metadata.kind === "exception" && !metadata.applicability.exceptionRule)
    return null;
  return {
    id: metadata.ref.entryId,
    scope: scope.kind,
    kind: metadata.kind,
    body: item.entry.body,
    revision: metadata.revision,
    sourceIds: [metadata.ref.entryId],
    statementAt: metadata.originalStatementAt,
    lastVerifiedAt: metadata.lastVerifiedAt,
    ...(metadata.kind === "observation" && observedCommitSha
      ? { observedCommitSha, temporalStatus: "at_commit" as const }
      : {}),
    ...(metadata.kind === "exception"
      ? { exceptionRuleId: metadata.applicability.exceptionRule!.entryId }
      : {}),
  };
}

export async function registerReviewMemoryRuntimeRoutes(
  app: FastifyInstance,
  gateway: ReviewMemoryRuntimeGateway,
): Promise<void> {
  for (const kind of ["bundle", "admit"] as const) {
    app.post(
      `/api/action/v2/memory/${kind}`,
      { bodyLimit: 4_096, logLevel: "silent" },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        try {
          const authorization = request.headers.authorization;
          if (
            !authorization?.startsWith("Bearer ") ||
            authorization.length > 8_200
          )
            return reply
              .code(401)
              .send({ code: "memory_authorization_required" });
          const token = authorization.slice(7);
          const timeoutMs = kind === "bundle" ? 2_000 : 450;
          const controls = {
            deadlineAt: new Date(Date.now() + timeoutMs),
            signal: AbortSignal.timeout(timeoutMs),
          };
          if (kind === "bundle")
            return reply.send(
              await withinDeadline(controls, () =>
                gateway.bundle(
                  token,
                  bundleSchema.parse(request.body),
                  controls,
                ),
              ),
            );
          return reply.send({
            protocolVersion: 2,
            eligible: await withinDeadline(controls, () =>
              gateway.admit(token, admitSchema.parse(request.body), controls),
            ),
          });
        } catch (error) {
          const code =
            error instanceof MemoryKnowledgeError
              ? error.code
              : error instanceof z.ZodError
                ? "invalid_input"
                : "unavailable";
          return reply
            .code(
              code === "forbidden" ? 403 : code === "invalid_input" ? 400 : 503,
            )
            .send({ code: `memory_${code}` });
        }
      },
    );
  }
}
