import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import * as PrismaEnums from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  admitMemoryReceiptInTransaction,
  createReviewMemoryInputAdmission,
  type MemoryAdmissionDiagnostic,
} from "./review-memory-admission";
import { reviewMemoryBinding } from "./review-memory-wire";
import {
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeEntryMetadata,
} from "../../../packages/features/memory/src/domain/memory-knowledge";
import type { MemoryKnowledgeAdmissionReceipt } from "../../../packages/features/memory/src/application/use-cases/memory-knowledge-service";
import { defaultMemoryPolicyConfig } from "../../../packages/features/memory/src/application/ports/memory-policy-config-port";

const databaseUrl = process.env.REVIEW_ROUTER_MEMORY_TEST_DATABASE_URL;
const schema = `memory_admission_${randomUUID().replaceAll("-", "")}`;
const generation = "admission_test";
const workspaceId = "admission_workspace";
const repositoryId = "admission_repository";
const sourceRepositoryId = "admission_source";
const authorizationId = "admission_authorization";
const scope = { kind: "workspace" as const, workspaceId };
const ref = { type: "entry" as const, scope, entryId: "mem_admission" };
const snapshotHash = "f".repeat(64);
const binding = {
  authorizationId,
  repositoryConnectionId: repositoryId,
  pullRequestNumber: 42,
  baseSha: "a".repeat(40),
  headSha: "b".repeat(40),
  reviewRevisionHash: "c".repeat(64),
};

/** Real Prisma and independent PostgreSQL connections; no store/transaction mocks.
 * The memory schema is the actual additive migrations. Authority tables contain
 * the current generated scalar projection; unrelated foreign-key graphs are not
 * reproduced, so these tests qualify locking/admission rather than full upgrades.
 */
describe.skipIf(!databaseUrl)(
  "atomic memory lease admission on PostgreSQL",
  () => {
    let admin: pg.Pool;
    let prisma: PrismaClient;
    let other: PrismaClient;
    let expiresAt: Date;
    let metadata: MemoryKnowledgeEntryMetadata;
    const guard = createReviewMemoryInputAdmission({
      enabled: true,
      generation,
      policy: { getPolicy: async () => defaultMemoryPolicyConfig },
    } as never);
    const command = {
      scope: { workspaceId, repositoryConnectionId: repositoryId },
      preparedManifestCanonicalJson: JSON.stringify({
        memoryBundleHash: snapshotHash,
      }),
    };
    const execution = {
      ...binding,
      workspaceId,
      scmRepositoryIdentityId: "admission_identity",
      mutationEpoch: 1n,
      revision: binding,
    };

    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/reviewrouter_memory_test"
      )
        throw new Error("admission_test_requires_disposable_loopback_database");
      admin = new pg.Pool({ connectionString: databaseUrl! });
      const version = await admin.query("SHOW server_version_num");
      if (Number(version.rows[0].server_version_num) < 170000)
        throw new Error("admission_test_requires_postgresql17");
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const fixture = new pg.Pool({
        connectionString: databaseUrl!,
        options: `-c search_path=${schema} -c timezone=UTC`,
      });
      try {
        await fixture.query(
          'CREATE TABLE "MemoryUsageEvent" ("id" TEXT PRIMARY KEY, "memoryItemId" TEXT)',
        );
        for (const name of [
          "000142_memory_knowledge_authority",
          "000143_memory_maintenance_fence",
        ])
          await fixture.query(
            await readFile(
              new URL(
                `../../../packages/platform/db/prisma/migrations/${name}/migration.sql`,
                import.meta.url,
              ),
              "utf8",
            ),
          );
        const enumNames = new Set(
          Prisma.dmmf.datamodel.models
            .filter((model) =>
              ["RepositoryConnection", "ReviewRunAuthorization"].includes(
                model.name,
              ),
            )
            .flatMap((model) =>
              model.fields
                .filter((field) => field.kind === "enum")
                .map((field) => field.type),
            ),
        );
        for (const name of enumNames) {
          const values = Object.values(
            Reflect.get(PrismaEnums, name) as Record<string, string>,
          );
          await fixture.query(
            `CREATE TYPE "${name}" AS ENUM (${values.map((value) => `'${value}'`).join(",")})`,
          );
        }
        for (const name of ["RepositoryConnection", "ReviewRunAuthorization"]) {
          const model = Prisma.dmmf.datamodel.models.find(
            (model) => model.name === name,
          )!;
          const columns = model.fields
            .filter((field) => field.kind !== "object")
            .map(
              (field) =>
                `"${field.name}" ${sqlType(field.type)}${field.name === (name === "RepositoryConnection" ? "id" : "authorizationId") ? " PRIMARY KEY" : ""}`,
            );
          await fixture.query(`CREATE TABLE "${name}" (${columns.join(",")})`);
        }
      } finally {
        await fixture.end();
      }
      const client = (name: string) =>
        new PrismaClient({
          adapter: new PrismaPg(
            {
              connectionString: databaseUrl!,
              options: `-c search_path=${schema} -c timezone=UTC -c application_name=${name}`,
              max: 4,
            },
            { schema },
          ),
        });
      prisma = client(`memory_admission_writer_${schema.slice(-12)}`);
      other = client(`memory_admission_reader_${schema.slice(-12)}`);
    });
    beforeEach(async () => {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "RepositoryConnection","ReviewRunAuthorization","MemoryKnowledgeEntry","MemoryKnowledgeScopeState","MemoryKnowledgeBundleReceipt","MemoryKnowledgeMaintenanceFence"',
      );
      const now = new Date();
      expiresAt = new Date(now.getTime() + 30000);
      for (const id of [repositoryId, sourceRepositoryId])
        await insertAuthority("RepositoryConnection", {
          id,
          workspaceId,
          selected: true,
          archived: false,
          scmRepositoryIdentityId: "admission_identity",
          visibility: "private",
          provider: "github",
          setupStatus: "not_configured",
        });
      await insertAuthority("ReviewRunAuthorization", {
        ...binding,
        workspaceId,
        scmRepositoryIdentityId: "admission_identity",
        mutationEpoch: 1n,
        trustDomain: "trusted_managed",
        state: "active",
        expiresAt: new Date(now.getTime() + 60000),
        maxExpiresAt: new Date(now.getTime() + 120000),
      });
      metadata = {
        ref,
        generation,
        revision: "1",
        contentApprovalRevision: "1",
        bodyDigest: "d".repeat(64),
        topicsDigest: "e".repeat(64),
        kind: "rule",
        lifecycle: "active",
        approval: {
          actor: {
            kind: "workspace_user",
            id: "user",
            githubUserId: null,
            login: null,
          },
          approvedAt: now.toISOString(),
          authorityRevision: "membership",
        },
        source: {
          type: "github_comment",
          sourceId: "github-node:MDQ6SXNzdWUx",
          revision: now.toISOString(),
          updatedAt: now.toISOString(),
          statementAt: now.toISOString(),
          repositoryId: sourceRepositoryId,
          pullRequestNumber: 42,
          url: null,
          visibility: "private",
          claimedBodyDigest: null,
          observedCommitSha: null,
        },
        applicability: {
          validUntil: null,
          observedCommitSha: null,
          exceptionRule: null,
        },
        originalStatementAt: now.toISOString(),
        lastVerifiedAt: now.toISOString(),
        pendingCommandId: null,
        revocationCommandId: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await prisma.memoryKnowledgeScopeState.create({
        data: {
          generation,
          scopeKey: memoryKnowledgeScopeKey(scope),
          workspaceId,
          epoch: 1n,
          updatedAt: now,
        },
      });
      await prisma.memoryKnowledgeMaintenanceFence.create({
        data: {
          generation,
          epoch: 0n,
          paused: false,
          actor: "fixture",
          updatedAt: now,
        },
      });
      await prisma.memoryKnowledgeEntry.create({
        data: {
          generation,
          scopeKey: memoryKnowledgeScopeKey(scope),
          entryId: ref.entryId,
          workspaceId,
          revision: 1,
          lifecycle: "active",
          metadata: metadata as never,
          updatedAt: now,
        },
      });
      const receipt: MemoryKnowledgeAdmissionReceipt = {
        generation,
        bundleHash: "a".repeat(64),
        expiresAt: expiresAt.toISOString(),
        scopes: [
          {
            scope,
            epoch: "1",
            entries: [{ ref, revision: "1", contentApprovalRevision: "1" }],
          },
        ],
      };
      await prisma.memoryKnowledgeBundleReceipt.create({
        data: {
          id: randomUUID(),
          authorizationId,
          bindingDigest: memoryKnowledgeDigest(reviewMemoryBinding(binding)),
          workspaceId,
          snapshotHash,
          receipt: receipt as never,
          policyVersion: 1,
          eligibilityEpoch: "epoch",
          expiresAt,
        },
      });
    });
    afterAll(async () => {
      await Promise.all([prisma?.$disconnect(), other?.$disconnect()]);
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.end();
      }
    });

    const admit = (client = other, prepared = command, admission = guard) =>
      client.$transaction(
        async (transaction) => {
          await admission.lock(transaction, prepared as never);
          return admission.admit(transaction, {
            command: prepared as never,
            execution: execution as never,
            now: new Date(),
          });
        },
        { isolationLevel: "Serializable", timeout: 5000 },
      );

    it("reports bounded decisions without letting a throwing observer change grants or epoch denials", async () => {
      const events: MemoryAdmissionDiagnostic[] = [];
      const observed = createReviewMemoryInputAdmission(
        {
          enabled: true,
          generation,
          policy: { getPolicy: async () => defaultMemoryPolicyConfig },
        } as never,
        (event) => {
          events.push(event);
          throw new Error("observer failure must not affect authority");
        },
      );
      expect(await admit(other, command, observed)).toBe(true);
      expect(events[0]).toMatchObject({
        boundary: "review_lease",
        outcome: "eligible",
        phase: "complete",
        authorizationId,
        snapshotHashPrefix: snapshotHash.slice(0, 12),
        elapsedMs: expect.any(Number),
      });
      await prisma.memoryKnowledgeScopeState.update({
        where: {
          generation_scopeKey: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
          },
        },
        data: { epoch: 2n },
      });
      expect(await admit(other, command, observed)).toBe(false);
      expect(events[1]).toMatchObject({ outcome: "denied", phase: "epoch" });
      expect(events).toHaveLength(2);
      expect(Object.keys(events[1]!).sort()).toEqual([
        "authorizationId",
        "boundary",
        "elapsedMs",
        "outcome",
        "phase",
        "snapshotHashPrefix",
      ]);
      expect(JSON.stringify(events)).not.toContain("observer failure");
    });

    it("distinguishes receipt binding and safe database exception codes without logging raw errors", async () => {
      const events: MemoryAdmissionDiagnostic[] = [];
      const runtime = {
        enabled: true,
        generation,
        policy: { getPolicy: async () => defaultMemoryPolicyConfig },
      };
      const observed = createReviewMemoryInputAdmission(
        runtime as never,
        (event) => events.push(event),
      );
      expect(
        await admit(
          other,
          {
            ...command,
            preparedManifestCanonicalJson: JSON.stringify({
              memoryBundleHash: "e".repeat(64),
            }),
          },
          observed,
        ),
      ).toBe(false);
      expect(events[0]).toMatchObject({
        outcome: "denied",
        phase: "receipt_binding",
      });
      runtime.policy.getPolicy = async () => {
        throw new Prisma.PrismaClientKnownRequestError(
          "do-not-log-query-or-token",
          { code: "P2028", clientVersion: "test" },
        );
      };
      expect(await admit(other, command, observed)).toBe(false);
      expect(events[1]).toMatchObject({
        outcome: "error",
        phase: "policy",
        errorCode: "P2028",
      });
      expect(JSON.stringify(events)).not.toContain("do-not-log");
    });

    async function conversationReceipt(): Promise<MemoryKnowledgeAdmissionReceipt> {
      const row = await prisma.memoryKnowledgeBundleReceipt.findUnique({
        where: {
          authorizationId_snapshotHash: { authorizationId, snapshotHash },
        },
      });
      return {
        ...(row!.receipt as unknown as MemoryKnowledgeAdmissionReceipt),
        contextPolicy: {
          audience: "public",
          repositoryId,
          allowedTasks: ["conversation"],
        },
      };
    }
    const conversationAdmit = (receipt: MemoryKnowledgeAdmissionReceipt) =>
      other.$transaction((transaction) =>
        admitMemoryReceiptInTransaction(
          transaction,
          {
            enabled: true,
            generation,
            policy: { getPolicy: async () => defaultMemoryPolicyConfig },
          } as never,
          receipt,
          {
            workspaceId,
            repositoryId,
            headSha: binding.headSha,
            task: "conversation",
            now: new Date(),
          },
        ),
      );
    it("checks task, audience and finite expiry in the same real conversation grant transaction", async () => {
      const receipt = await conversationReceipt();
      expect(await conversationAdmit(receipt)).toBe(false);
      metadata = {
        ...metadata,
        source: { ...metadata.source!, visibility: "public" },
      };
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: ref.entryId,
          },
        },
        data: { metadata: metadata as never },
      });
      expect(await conversationAdmit(receipt)).toBe(true);
      expect(
        await conversationAdmit({
          ...receipt,
          contextPolicy: {
            ...receipt.contextPolicy!,
            allowedTasks: ["pr_description"],
          },
        }),
      ).toBe(false);
      expect(
        await conversationAdmit({ ...receipt, expiresAt: "invalid-date" }),
      ).toBe(false);
      expect(
        await conversationAdmit({
          ...receipt,
          contextPolicy: {
            ...receipt.contextPolicy!,
            repositoryId: "other_repository",
          },
        }),
      ).toBe(false);
    });
    it("admits the same private fact internally but rejects an internal receipt for public description", async () => {
      const original = await conversationReceipt();
      const internal = {
        ...original,
        contextPolicy: {
          audience: "internal" as const,
          repositoryId,
          allowedTasks: ["review" as const, "investigation" as const],
        },
      };
      const check = (
        receipt: MemoryKnowledgeAdmissionReceipt,
        task: "review" | "pr_description",
      ) =>
        other.$transaction((transaction) =>
          admitMemoryReceiptInTransaction(
            transaction,
            {
              enabled: true,
              generation,
              policy: { getPolicy: async () => defaultMemoryPolicyConfig },
            } as never,
            receipt,
            {
              workspaceId,
              repositoryId,
              headSha: binding.headSha,
              task,
              now: new Date(),
            },
          ),
        );
      expect(await check(internal, "review")).toBe(true);
      expect(await check(internal, "pr_description")).toBe(false);
      const description = {
        ...original,
        contextPolicy: {
          audience: "public" as const,
          repositoryId,
          allowedTasks: ["pr_description" as const],
        },
      };
      expect(await check(description, "pr_description")).toBe(false);
    });

    it("denies new conversation dispatch after source loss, retirement or receipt epoch revocation", async () => {
      const receipt = await conversationReceipt();
      metadata = {
        ...metadata,
        source: { ...metadata.source!, visibility: "public" },
      };
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: ref.entryId,
          },
        },
        data: { metadata: metadata as never },
      });
      expect(await conversationAdmit(receipt)).toBe(true);
      await prisma.repositoryConnection.update({
        where: { id: sourceRepositoryId },
        data: { selected: false },
      });
      expect(await conversationAdmit(receipt)).toBe(false);
      await prisma.repositoryConnection.update({
        where: { id: sourceRepositoryId },
        data: { selected: true },
      });
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: ref.entryId,
          },
        },
        data: { metadata: { ...metadata, lifecycle: "retired" } as never },
      });
      expect(await conversationAdmit(receipt)).toBe(false);
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: ref.entryId,
          },
        },
        data: { metadata: metadata as never },
      });
      await prisma.memoryKnowledgeScopeState.update({
        where: {
          generation_scopeKey: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
          },
        },
        data: { epoch: 2n },
      });
      expect(await conversationAdmit(receipt)).toBe(false);
    });

    it("admits the exact receipt and rejects paused memory while leaving no-memory acquisition independent", async () => {
      expect(await admit()).toBe(true);
      await prisma.memoryKnowledgeMaintenanceFence.update({
        where: { generation },
        data: { paused: true, epoch: 1n },
      });
      expect(await admit()).toBe(false);
      expect(
        await admit(other, {
          ...command,
          preparedManifestCanonicalJson: JSON.stringify({
            memoryBundleHash: null,
          }),
        }),
      ).toBe(true);
    });
    it("checks every linked source repository and the exact entry revision", async () => {
      await prisma.repositoryConnection.update({
        where: { id: sourceRepositoryId },
        data: { archived: true },
      });
      expect(await admit()).toBe(false);
      await prisma.repositoryConnection.update({
        where: { id: sourceRepositoryId },
        data: { archived: false },
      });
      await prisma.memoryKnowledgeEntry.update({
        where: {
          generation_scopeKey_entryId: {
            generation,
            scopeKey: memoryKnowledgeScopeKey(scope),
            entryId: ref.entryId,
          },
        },
        data: {
          metadata: { ...metadata, revision: "2" } as never,
          revision: 2,
        },
      });
      expect(await admit()).toBe(false);
    });
    it.each(["authorization", "source", "scope"] as const)(
      "fails closed when a %s row changes while an older Serializable snapshot waits",
      async (target) => {
        const locked = deferred();
        const release = deferred();
        const writer = prisma.$transaction(
          async (transaction) => {
            if (target === "authorization")
              await transaction.reviewRunAuthorization.update({
                where: { authorizationId },
                data: { state: "revoked" },
              });
            else if (target === "source")
              await transaction.repositoryConnection.update({
                where: { id: sourceRepositoryId },
                data: { selected: false },
              });
            else
              await transaction.memoryKnowledgeScopeState.update({
                where: {
                  generation_scopeKey: {
                    generation,
                    scopeKey: memoryKnowledgeScopeKey(scope),
                  },
                },
                data: { epoch: 2n },
              });
            locked.resolve();
            await release.promise;
          },
          { timeout: 5000 },
        );
        await locked.promise;
        const reader = admit().then(
          (value) => ({ allowed: value }),
          () => ({ allowed: false }),
        );
        try {
          await waitForBlockedReader();
        } finally {
          release.resolve();
        }
        await writer;
        expect(await reader).toEqual({ allowed: false });
      },
    );

    async function insertAuthority(
      name: string,
      overrides: Record<string, unknown>,
    ) {
      const model = Prisma.dmmf.datamodel.models.find(
        (model) => model.name === name,
      )!;
      const fields = model.fields.filter((field) => field.kind !== "object");
      const values = fields.map((field) => {
        if (field.name in overrides) return overrides[field.name];
        if (field.type === "DateTime") return new Date();
        if (field.type === "BigInt") return "1";
        if (field.type === "Int") return 1;
        if (field.type === "Boolean") return true;
        if (field.type === "Json") return "{}";
        if (field.kind === "enum")
          return Object.values(
            Reflect.get(PrismaEnums, field.type) as Record<string, string>,
          )[0];
        return "fixture";
      });
      await admin.query(
        `INSERT INTO "${schema}"."${name}" (${fields.map((field) => `"${field.name}"`).join(",")}) VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")})`,
        values,
      );
    }
    async function waitForBlockedReader() {
      for (let attempt = 0; attempt < 500; attempt++) {
        const result = await admin.query(
          "SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
          [`memory_admission_reader_${schema.slice(-12)}`],
        );
        if (result.rows[0]?.count > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      throw new Error(
        "memory_admission_reader_did_not_wait_on_real_database_lock",
      );
    }
  },
);
function sqlType(type: string): string {
  return (
    (
      {
        String: "TEXT",
        Int: "INTEGER",
        BigInt: "BIGINT",
        Boolean: "BOOLEAN",
        DateTime: "TIMESTAMP(3)",
        Json: "JSONB",
      } as Record<string, string>
    )[type] ?? `"${type}"`
  );
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
