import assert from "node:assert/strict";
import { settleMemoryCommand } from "./settle-memory-command.ts";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../packages/platform/db/src/index.js";
import {
  createMemoryKnowledgeRuntime,
  parseMemoryProviderConfig,
} from "../../packages/features/memory/src/composition/index.js";
import {
  PrismaMemoryKnowledgeAccess,
  PrismaMemoryPermission,
} from "../../packages/features/memory/src/infrastructure/index.js";
import { HindsightMemoryProvider } from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-memory-provider.js";
import type {
  MemoryKnowledgeCommand,
  MemoryKnowledgeScope,
} from "../../packages/features/memory/src/index.js";

// Called only inside the existing fresh Compose sandbox, using its generated env.
assert.equal(process.env.REVIEW_ROUTER_MEMORY_PROVIDER, "hindsight");
assert.equal(process.env.REVIEW_ROUTER_MEMORY_ENABLED, "true");
const url = new URL(process.env.DATABASE_URL!);
assert.equal(url.hostname, "postgres");
assert.equal(url.pathname, "/review_router");
const health = await fetch(
  `${process.env.REVIEW_ROUTER_MEMORY_HINDSIGHT_URL}/health/ready`,
  { signal: AbortSignal.timeout(5_000) },
);
assert(health.ok, "selfhost_native_bridge_unavailable");
const id = `selfhost-memory-${randomUUID()}`;
const prisma = createPrismaClient({ poolMax: 2 });
const controls = () => ({ deadlineAt: new Date(Date.now() + 25_000) });
try {
  // The ordinary authenticated workspace-user fixture: real user + owner
  // membership, checked by the production permission adapter without overrides.
  await prisma.user.create({ data: { id } });
  await prisma.workspace.create({ data: { id, slug: id, name: id } });
  await prisma.workspaceMember.create({
    data: { workspaceId: id, userId: id, role: "owner" },
  });
  const runtime = await createMemoryKnowledgeRuntime({
    prisma,
    env: process.env,
  });
  assert(runtime.enabled);
  const service = runtime.forAccess(
    new PrismaMemoryKnowledgeAccess({
      prisma,
      permissions: new PrismaMemoryPermission(prisma),
      policy: runtime.policy,
    }),
  );
  const actor = {
    kind: "workspace_user" as const,
    id,
    githubUserId: null,
    login: null,
  };
  const scope: MemoryKnowledgeScope = { kind: "workspace", workspaceId: id };
  const ref = {
    type: "entry" as const,
    scope,
    entryId: `mem_${randomUUID().replaceAll("-", "")}`,
  };
  const now = new Date().toISOString();
  const approval = {
    actor,
    approvedAt: now,
    authorityRevision: "selfhost-owner-membership",
  };
  const body =
    "Parcel tracking identifiers are opaque strings. Preserve leading zeroes and original case.";
  const save: Extract<MemoryKnowledgeCommand, { kind: "save" }> = {
    kind: "save",
    commandId: randomUUID(),
    ref,
    expectedRevision: null,
    generation: runtime.generation,
    providerProfileVersion: runtime.providerProfileVersion,
    approval,
    body,
    knowledgeKind: "rule",
    topicIds: [],
    temporalMode: "preserve_original",
    source: {
      type: "manual",
      sourceId: randomUUID(),
      revision: "1",
      updatedAt: now,
      statementAt: now,
      repositoryId: null,
      pullRequestNumber: null,
      url: null,
      visibility: "internal",
      claimedBodyDigest: null,
      observedCommitSha: null,
    },
    applicability: {
      validUntil: null,
      observedCommitSha: null,
      exceptionRule: null,
    },
  };
  await service.save(save, controls());
  const progress = (
    commandId: string,
    accepted: readonly ("published" | "completed" | "cleanup_pending")[],
  ) =>
    settleMemoryCommand({
      progress: () => service.progress({ scope, commandId, actor }, controls()),
      deliver: () => service.deliver({ scope, commandId }, controls()),
      hasLiveClaim: async () => {
        const row = await prisma.memoryKnowledgeCommand.findUniqueOrThrow({
          where: { id: commandId },
          select: { state: true, claimUntil: true },
        });
        return (
          row.state !== "unknown" ||
          Boolean(row.claimUntil && row.claimUntil.getTime() > Date.now())
        );
      },
      accepted,
      deadlineAt: new Date(Date.now() + 180_000),
    });
  const saved = await progress(save.commandId, ["published"]);
  assert.equal((await service.read({ actor, ref }, controls())).body, body);
  await assert.rejects(
    service.read({ actor: { ...actor, id: `${id}-foreign` }, ref }, controls()),
    (error: unknown) =>
      Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "forbidden",
      ),
  );
  const recallUntil = Date.now() + 60_000;
  for (;;) {
    const bundle = await service.bundle(
      {
        actor,
        scopes: [scope],
        query: "Parcel tracking identifiers leading zeroes original case",
      },
      controls(),
    );
    if (
      !bundle.degraded &&
      bundle.scopes.some((s) =>
        s.items.some((e) => e.type === "entry" && e.entry.body === body),
      )
    )
      break;
    assert(Date.now() < recallUntil, "native_memory_not_recalled");
    await new Promise((done) => setTimeout(done, 500));
  }
  const forgetId = randomUUID();
  await service.forget(
    {
      kind: "forget",
      commandId: forgetId,
      ref,
      expectedRevision: saved.revision,
      generation: runtime.generation,
      providerProfileVersion: runtime.providerProfileVersion,
      approval,
    },
    controls(),
  );
  assert.equal((await service.read({ actor, ref }, controls())).body, null);
  const forgotten = await progress(forgetId, ["cleanup_pending", "completed"]);
  const providerConfig = parseMemoryProviderConfig(process.env);
  assert(providerConfig.kind === "hindsight");
  const nativeCurrentDocumentAbsent =
    (await new HindsightMemoryProvider(providerConfig).read(
      ref,
      controls(),
    )) === null;
  // A pending physical cleanup may retain native content. Product read/recall
  // must already fence it; only completed cleanup requires native absence.
  if (forgotten.state === "completed")
    assert(
      nativeCurrentDocumentAbsent,
      "completed_forget_native_document_present",
    );
  const afterForgetBundle = await service.bundle(
    {
      actor,
      scopes: [scope],
      query: "Parcel tracking identifiers leading zeroes original case",
    },
    controls(),
  );
  assert(
    !afterForgetBundle.degraded &&
      afterForgetBundle.scopes.every((s) =>
        s.items.every(
          (e) => e.type !== "entry" || e.entry.ref.entryId !== ref.entryId,
        ),
      ),
    "forgotten_memory_still_recalled",
  );
  console.log(
    JSON.stringify({
      status: "selfhost_real_memory_storage_passed",
      workspaceId: id,
      entryId: ref.entryId,
      saveCommandId: save.commandId,
      forgetCommandId: forgetId,
      saved: saved.state,
      nativeBridgeReady: true,
      readback: true,
      recalled: true,
      foreignUserDenied: true,
      forget: forgotten.state,
      nativeCurrentDocumentAbsent,
      pendingNativeContentFenced:
        forgotten.state === "cleanup_pending" && !nativeCurrentDocumentAbsent,
      recallExcludedAfterForget: true,
      productPhysicalForgetClaimed: false,
    }),
  );
} finally {
  await prisma.$disconnect();
}
