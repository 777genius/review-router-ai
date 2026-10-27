import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  validateActionSessionAgainstRepository,
  type ActionControlPlaneRepositoryPort,
  type ActionEntitlementPolicyPort,
  type ActionSessionClaims,
  type ActionSessionTokenServicePort,
} from "@reviewrouter/features-action-control-plane";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  type MemoryActor,
  type MemoryEntryRef,
  type MemoryKnowledgeEntryMetadata,
  type MemoryKnowledgeScope,
  type MemoryKnowledgeSource,
  type MemoryRequestControls,
} from "@reviewrouter/features-memory";
import {
  approvedMemorySourceApplicable,
  PrismaMemoryKnowledgeAccess,
  PrismaMemoryPermission,
} from "@reviewrouter/features-memory/infrastructure";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import type { Clock } from "@reviewrouter/shared";
import {
  originalActionMemoryRevision,
  prepareActionMemoryCommand,
} from "./action-memory-command-replay.js";
import {
  GitHubMemorySourceVerifier,
  githubMemorySourceSchema,
} from "./github/github-memory-source-verifier.js";

export type ActionMemoryV2Dependencies = {
  readonly prisma: PrismaClient;
  readonly runtime: MemoryKnowledgeRuntime;
  readonly repositories: ActionControlPlaneRepositoryPort;
  readonly sessions: ActionSessionTokenServicePort;
  readonly entitlements?: ActionEntitlementPolicyPort;
  readonly clock: Clock;
  readonly sourceVerifier: GitHubMemorySourceVerifier;
  readonly enabled?: boolean;
};
const commandId = z.uuid();
const entryId = z.string().regex(/^mem_[a-zA-Z0-9_-]{1,120}$/);
const revision = z.string().regex(/^[1-9]\d{0,9}$/);
const candidateSchema = z
  .object({
    protocolVersion: z.literal(2),
    commandId,
    expectedRevision: z.null(),
    kind: z.literal("rule"),
    requestedScope: z.enum(["repository", "workspace"]).nullable().optional(),
    candidateBody: z.string().min(1).max(1_000),
    intent: z.enum([
      "explicit_command",
      "explicit_natural_language",
      "model_suggested_candidate",
      "ambiguous_discussion",
      "no_memory_intent",
    ]),
    extractionMethod: z.enum([
      "explicit_command",
      "explicit_natural_language",
      "model_suggested_candidate",
    ]),
    extractionVersion: z.number().int().min(1).max(100),
    source: githubMemorySourceSchema,
  })
  .strict();
const commandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("update_memory"),
      commandId,
      memoryItemId: entryId,
      expectedRevision: revision,
      body: z.string().min(1).max(1_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("disable_memory"),
      commandId,
      memoryItemId: entryId,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("forget_memory"),
      commandId,
      memoryItemId: entryId,
      expectedRevision: revision,
    })
    .strict(),
  z
    .object({
      kind: z.literal("operation_status"),
      commandId,
      operationId: z.uuid(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("list_memory"),
      commandId,
      view: z.enum(["active", "pending"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("confirm_suggestion"),
      commandId,
      suggestionId: z.string().max(120),
    })
    .strict(),
  z
    .object({
      kind: z.literal("reject_suggestion"),
      commandId,
      suggestionId: z.string().max(120),
      reason: z.string().max(500).nullable().optional(),
    })
    .strict(),
]);
const commandsSchema = z
  .object({
    protocolVersion: z.literal(2),
    commands: z.array(commandSchema).min(1).max(5),
    source: githubMemorySourceSchema,
  })
  .strict();
const detailSchema = z
  .object({
    commandId: commandId.optional(),
    sourceId: z.string().min(1).max(200),
    sourceNodeId: z.string().min(1).max(200),
    sourceRevision: z.iso.datetime({ offset: true }),
    pullRequestNumber: z.coerce.number().int().positive(),
    headSha: z.string(),
    baseSha: z.string(),
    githubRepositoryId: z.string(),
    sourceType: z.enum(["github_issue_comment", "github_review_comment"]),
  })
  .strict();

function controls(): MemoryRequestControls {
  return {
    deadlineAt: new Date(Date.now() + 8_000),
    signal: AbortSignal.timeout(8_000),
  };
}

async function session(
  request: FastifyRequest,
  dependencies: ActionMemoryV2Dependencies,
): Promise<ActionSessionClaims> {
  if (dependencies.enabled === false)
    throw new MemoryKnowledgeError("disabled");
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ") || header.length > 8_200)
    throw new MemoryKnowledgeError("forbidden");
  const claims = await dependencies.sessions.verify({
    token: header.slice(7),
    now: dependencies.clock.now(),
  });
  const repository =
    await dependencies.repositories.findSelectedRepositoryByGithubId(
      claims.githubRepositoryId,
    );
  if (!repository) throw new MemoryKnowledgeError("forbidden");
  validateActionSessionAgainstRepository({ session: claims, repository });
  await dependencies.entitlements?.assertActionControlPlaneAllowed({
    workspaceId: claims.workspaceId,
    repositoryId: claims.repositoryId,
    repositoryFullName: claims.repository,
  });
  return claims;
}

function scopedService(
  dependencies: ActionMemoryV2Dependencies,
  actor: MemoryActor,
  source: MemoryKnowledgeSource,
  scope: MemoryKnowledgeScope,
) {
  const approvedSource: MemoryKnowledgeSource =
    scope.kind === "workspace" && source.visibility !== "public"
      ? { ...source, url: null }
      : source;
  const access = new PrismaMemoryKnowledgeAccess({
    prisma: dependencies.prisma,
    policy: dependencies.runtime.policy,
    permissions: new PrismaMemoryPermission(dependencies.prisma, {
      repositoryMaintainers:
        dependencies.sourceVerifier.repositoryMaintainers(),
    }),
    sourceAuthority: {
      async verifySource(input) {
        if (
          input.actor.id !== actor.id ||
          memoryKnowledgeDigest(input.scope) !== memoryKnowledgeDigest(scope) ||
          memoryKnowledgeDigest(input.source) !==
            memoryKnowledgeDigest(approvedSource)
        )
          throw new MemoryKnowledgeError("forbidden");
        return approvedSource;
      },
      sourceApplicable: approvedMemorySourceApplicable,
    },
    now: () => dependencies.clock.now(),
  });
  return {
    access,
    source: approvedSource,
    service: dependencies.runtime.forAccess(access),
  };
}

async function entry(
  dependencies: ActionMemoryV2Dependencies,
  claims: ActionSessionClaims,
  id: string,
): Promise<MemoryKnowledgeEntryMetadata> {
  const rows = await dependencies.prisma.memoryKnowledgeEntry.findMany({
    where: {
      generation: dependencies.runtime.generation,
      workspaceId: claims.workspaceId,
      entryId: id,
    },
    take: 2,
  });
  if (rows.length !== 1) throw new MemoryKnowledgeError("not_found");
  const metadata = rows[0]!.metadata as unknown as MemoryKnowledgeEntryMetadata;
  if (
    metadata.ref.scope.kind === "user_preference" ||
    metadata.ref.scope.workspaceId !== claims.workspaceId ||
    (metadata.ref.scope.kind === "repository" &&
      metadata.ref.scope.repositoryId !== claims.repositoryId)
  )
    throw new MemoryKnowledgeError("forbidden");
  return metadata;
}

export async function registerActionMemoryV2Routes(
  app: FastifyInstance,
  dependencies: ActionMemoryV2Dependencies,
): Promise<void> {
  app.post(
    "/api/action/v2/memory/candidates",
    { bodyLimit: 8_192, logLevel: "silent" },
    guarded(async (request) => {
      const input = candidateSchema.parse(request.body);
      const claims = await session(request, dependencies);
      if (
        (input.intent !== "explicit_command" &&
          input.intent !== "explicit_natural_language") ||
        input.extractionMethod !== input.intent
      )
        return {
          status: "rejected",
          reason: "explicit_approval_required",
          retryable: false,
        };
      const budget = controls();
      const verified = await dependencies.sourceVerifier.verify(
        claims,
        input.source,
        budget,
      );
      const scope: MemoryKnowledgeScope =
        input.requestedScope === "workspace"
          ? { kind: "workspace", workspaceId: claims.workspaceId }
          : {
              kind: "repository",
              workspaceId: claims.workspaceId,
              repositoryId: claims.repositoryId,
            };
      const { access, service, source } = scopedService(
        dependencies,
        verified.actor,
        verified.source,
        scope,
      );
      const ref: MemoryEntryRef = {
        type: "entry",
        scope,
        entryId: `mem_${input.commandId.replaceAll("-", "")}`,
      };
      await access.authorize(
        { actor: verified.actor, scope, action: "manage" },
        budget,
      );
      const prepared = await prepareActionMemoryCommand({
        store: dependencies.runtime.store,
        generation: dependencies.runtime.generation,
        ref,
        actor: verified.actor,
        source,
        commandId: input.commandId,
        expectedRevision: null,
        wire: input,
        now: dependencies.clock.now(),
      });
      const operation =
        prepared.replay ??
        (await service.save(
          {
            kind: "save",
            ref,
            commandId: input.commandId,
            expectedRevision: null,
            generation: dependencies.runtime.generation,
            providerProfileVersion: dependencies.runtime.providerProfileVersion,
            approval: prepared.approval,
            body: input.candidateBody,
            knowledgeKind: "rule",
            topicIds: [],
            source,
            applicability: {
              validUntil: null,
              observedCommitSha: null,
              exceptionRule: null,
            },
            temporalMode: "preserve_original",
          },
          budget,
        ));
      return {
        status: operation.state,
        id: operation.id,
        entryId: operation.ref.entryId,
        revision: operation.revision,
      };
    }),
  );

  app.get(
    "/api/action/v2/memory/entries/:id",
    { logLevel: "silent" },
    guarded(async (request) => {
      const id = entryId.parse((request.params as { id: string }).id);
      const query = detailSchema.parse(request.query);
      const claims = await session(request, dependencies);
      const budget = controls();
      const verified = await dependencies.sourceVerifier.verify(
        claims,
        githubMemorySourceSchema.parse({
          type: query.sourceType,
          sourceId: query.sourceId,
          nodeId: query.sourceNodeId,
          revision: query.sourceRevision,
          updatedAt: query.sourceRevision,
          statementAt: query.sourceRevision,
          claimedBodyDigest: "0".repeat(64),
          githubRepositoryId: query.githubRepositoryId,
          pullRequestNumber: query.pullRequestNumber,
          headSha: query.headSha,
          baseSha: query.baseSha,
          visibility: "private",
        }),
        budget,
      );
      const metadata = await entry(dependencies, claims, id);
      await scopedService(
        dependencies,
        verified.actor,
        verified.source,
        metadata.ref.scope,
      ).access.authorize(
        { actor: verified.actor, scope: metadata.ref.scope, action: "manage" },
        budget,
      );
      const existing = query.commandId
        ? await dependencies.runtime.store.findCommand({
            commandId: query.commandId,
            scope: metadata.ref.scope,
            generation: dependencies.runtime.generation,
          })
        : null;
      return {
        entryId: id,
        revision: existing
          ? originalActionMemoryRevision(existing, verified.actor, metadata.ref)
          : metadata.revision,
      };
    }),
  );

  app.post(
    "/api/action/v2/memory/commands",
    { bodyLimit: 12_288, logLevel: "silent" },
    guarded(async (request) => {
      const input = commandsSchema.parse(request.body);
      const claims = await session(request, dependencies);
      const budget = controls();
      const verified = await dependencies.sourceVerifier.verify(
        claims,
        input.source,
        budget,
      );
      const results: Record<string, unknown>[] = [];
      for (const command of input.commands) {
        if (
          command.kind === "confirm_suggestion" ||
          command.kind === "reject_suggestion"
        ) {
          results.push({
            kind: command.kind,
            status: "rejected",
            reason: "use_memory_page_for_approval",
            retryable: false,
          });
          continue;
        }
        if (command.kind === "list_memory") {
          const scope: MemoryKnowledgeScope = {
            kind: "repository",
            workspaceId: claims.workspaceId,
            repositoryId: claims.repositoryId,
          };
          await scopedService(
            dependencies,
            verified.actor,
            verified.source,
            scope,
          ).access.authorize(
            { actor: verified.actor, scope, action: "read" },
            budget,
          );
          // Shared knowledge is inspected in the authenticated UI, never echoed into a public thread.
          results.push({
            kind: command.kind,
            status: "noop",
            reason: "open_memory_page",
          });
          continue;
        }
        if (command.kind === "operation_status") {
          const row =
            await dependencies.prisma.memoryKnowledgeCommand.findFirst({
              where: {
                id: command.operationId,
                generation: dependencies.runtime.generation,
                workspaceId: claims.workspaceId,
              },
              select: { entryId: true },
            });
          if (!row) throw new MemoryKnowledgeError("not_found");
          const metadata = await entry(dependencies, claims, row.entryId);
          const operation = await scopedService(
            dependencies,
            verified.actor,
            verified.source,
            metadata.ref.scope,
          ).service.progress(
            {
              actor: verified.actor,
              scope: metadata.ref.scope,
              commandId: command.operationId,
            },
            budget,
          );
          results.push({
            kind: command.kind,
            status: operation.state,
            id: operation.id,
            entryId: operation.ref.entryId,
            revision: operation.revision,
            ...(operation.safeReason ? { reason: operation.safeReason } : {}),
          });
          continue;
        }
        const metadata = await entry(
          dependencies,
          claims,
          command.memoryItemId,
        );
        const newSource =
          metadata.kind === "observation"
            ? { ...verified.source, observedCommitSha: input.source.headSha }
            : verified.source;
        const { access, service, source } = scopedService(
          dependencies,
          verified.actor,
          newSource,
          metadata.ref.scope,
        );
        await access.authorize(
          {
            actor: verified.actor,
            scope: metadata.ref.scope,
            action: "manage",
          },
          budget,
        );
        const prepared = await prepareActionMemoryCommand({
          store: dependencies.runtime.store,
          generation: dependencies.runtime.generation,
          ref: metadata.ref,
          actor: verified.actor,
          source,
          commandId: command.commandId,
          expectedRevision: command.expectedRevision,
          wire: command,
          now: dependencies.clock.now(),
        });
        if (prepared.replay) {
          const operation = prepared.replay;
          results.push({
            kind: command.kind,
            status: operation.state,
            id: operation.id,
            entryId: operation.ref.entryId,
            revision: operation.revision,
          });
          continue;
        }
        const context = {
          ref: metadata.ref,
          commandId: command.commandId,
          expectedRevision: command.expectedRevision,
          generation: dependencies.runtime.generation,
          providerProfileVersion: dependencies.runtime.providerProfileVersion,
          approval: prepared.approval,
        };
        let operation;
        if (command.kind === "forget_memory")
          operation = await service.forget(
            { ...context, kind: "forget" },
            budget,
          );
        else if (command.kind === "disable_memory")
          operation = await service.retire(
            { ...context, kind: "retire" },
            budget,
          );
        else {
          const current = await service.read(
            { actor: verified.actor, ref: metadata.ref },
            budget,
          );
          if (!current || current.body === null)
            throw new MemoryKnowledgeError("unavailable", true);
          operation = await service.save(
            {
              ...context,
              kind: "save",
              body: command.body,
              knowledgeKind: metadata.kind,
              topicIds: current.topicIds,
              source,
              applicability: {
                ...metadata.applicability,
                observedCommitSha: source.observedCommitSha,
              },
              temporalMode: "preserve_original",
            },
            budget,
          );
        }
        results.push({
          kind: command.kind,
          status: operation.state,
          id: operation.id,
          entryId: operation.ref.entryId,
          revision: operation.revision,
        });
      }
      return { protocolVersion: 2, results };
    }),
  );
}

function guarded(handler: (request: FastifyRequest) => Promise<unknown>) {
  return async (
    request: FastifyRequest,
    reply: import("fastify").FastifyReply,
  ) => {
    reply.header("cache-control", "private, no-store");
    try {
      return reply.send(await handler(request));
    } catch (error) {
      const code =
        error instanceof MemoryKnowledgeError
          ? error.code
          : error instanceof z.ZodError
            ? "invalid_input"
            : "unavailable";
      return reply
        .code(
          code === "forbidden"
            ? 403
            : code === "not_found"
              ? 404
              : code === "conflict"
                ? 409
                : code === "invalid_input"
                  ? 400
                  : 503,
        )
        .send({
          status: "rejected",
          reason: `memory_${code}`,
          retryable: error instanceof MemoryKnowledgeError && error.retryable,
        });
    }
  };
}
