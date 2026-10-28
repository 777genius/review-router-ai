import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  reviewSkillsRuntimeGrantStatements,
  reviewSkillsRuntimeGateStatements,
  reviewSkillsRuntimeTables,
} from "./review-skills-runtime-grants.js";
import {
  createPrismaReviewSkillsAdmission,
  createPrismaReviewSkillsService,
} from "../packages/features/review-skills/src/composition/index.js";
import type { ReviewSkillsService } from "../packages/features/review-skills/src/application/contracts.js";
import { claimReviewSkillsPostgresFixture } from "../packages/features/review-skills/src/tests/postgres-fixture.js";

const databaseUrl = process.env.REVIEW_SKILLS_TEST_DATABASE_URL;
if (!databaseUrl && process.env.REVIEW_SKILLS_REQUIRE_PG === "1")
  throw new Error("review_skills_required_postgresql_missing");

describe.skipIf(!databaseUrl)(
  "Review Skills production ACL with actual unprivileged logins",
  () => {
    const tag = randomUUID().replaceAll("-", "").slice(0, 16);
    const roles = ["web", "api", "worker"].map((role) => ({
      role,
      username: `rr_skills_${tag}_${role}`,
      password: randomUUID(),
    }));
    const actor = { userId: `skills-acl-${tag}-owner` };
    const source = `skills-acl-${tag}-source`,
      destination = `skills-acl-${tag}-destination`,
      repository = `skills-acl-${tag}-repository`;
    const baseSha = "d".repeat(40);
    let owner: Client,
      fixture: PrismaClient,
      web: PrismaClient,
      api: PrismaClient,
      worker: PrismaClient;
    let service: ReviewSkillsService;
    let admission: ReturnType<typeof createPrismaReviewSkillsAdmission>;
    const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const waitForLock = async (username: string) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const result = await owner.query(
          "SELECT 1 FROM pg_catalog.pg_stat_activity WHERE usename=$1 AND wait_event_type=$2",
          [username, "Lock"],
        );
        if (result.rowCount) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`skills_fixture_expected_lock:${username}`);
    };
    beforeAll(async () => {
      const target = new URL(databaseUrl!);
      owner = await claimReviewSkillsPostgresFixture(databaseUrl!);
      fixture = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl! }),
      });
      expect(
        (
          await owner.query(
            "SELECT to_regprocedure('public.rr_review_skills_repository_lock(text,text[])') IS NOT NULL AS installed",
          )
        ).rows[0].installed,
      ).toBe(true);
      const names = roles.map(({ username }) => quoted(username)).join(", ");
      for (const role of roles) {
        await owner.query(
          `CREATE ROLE ${quoted(role.username)} LOGIN PASSWORD '${role.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
        );
      }
      await owner.query(
        `GRANT CONNECT ON DATABASE ${quoted(target.pathname.slice(1))} TO ${names}`,
      );
      await owner.query(`GRANT USAGE ON SCHEMA public TO ${names}`);
      // Disposable migration fixtures retain their bootstrap owner; production
      // tables already belong to this existing canonical NOLOGIN schema owner.
      await owner.query(
        'GRANT SELECT, UPDATE(id) ON TABLE public."RepositoryConnection" TO reviewrouter_release_schema_owner',
      );
      for (const table of reviewSkillsRuntimeTables)
        await owner.query(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quoted(table)} TO ${names}`,
        );
      // A broad table REVOKE alone would leave these old column grants effective.
      await owner.query(
        `GRANT UPDATE(name) ON TABLE public."ReviewSkillRevision" TO ${quoted(roles[1]!.username)}`,
      );
      await owner.query(
        `GRANT INSERT("skillId") ON TABLE public."ReviewSkillBinding" TO ${quoted(roles[2]!.username)}`,
      );
      await owner.query(reviewSkillsRuntimeGrantStatements(roles));
      for (const role of roles.filter((r) => r.role !== "worker")) {
        await owner.query(
          `GRANT SELECT ON TABLE public."Workspace", public."WorkspaceMember", public."User", public."RepositoryConnection" TO ${quoted(role.username)}`,
        );
        await owner.query(
          `GRANT UPDATE(id) ON TABLE public."Workspace" TO ${quoted(role.username)}`,
        );
      }
      await owner.query(
        `GRANT UPDATE("updatedAt") ON TABLE public."Workspace" TO ${quoted(roles[0]!.username)}`,
      );
      await owner.query(
        `GRANT UPDATE("userId") ON TABLE public."WorkspaceMember" TO ${quoted(roles[0]!.username)}`,
      );
      await owner.query(
        `GRANT INSERT ON TABLE public."AuditEvent" TO ${quoted(roles[0]!.username)}`,
      );
      const clients = roles.map((role) => {
        const url = new URL(databaseUrl!);
        url.username = role.username;
        url.password = role.password;
        return new PrismaClient({
          adapter: new PrismaPg({
            connectionString: url.toString(),
            application_name: role.username,
          }),
        });
      });
      [web, api, worker] = clients as [
        PrismaClient,
        PrismaClient,
        PrismaClient,
      ];
      for (let index = 0; index < clients.length; index++) {
        const result = await clients[index]!.$queryRaw<
          readonly {
            current_user: string;
            session_user: string;
            privileged: boolean;
            owner: boolean;
          }[]
        >`SELECT current_user, session_user, (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) AS privileged, pg_has_role(current_user, 'reviewrouter_release_schema_owner', 'SET') AS owner FROM pg_roles WHERE rolname=current_user`;
        expect(result[0]).toEqual({
          current_user: roles[index]!.username,
          session_user: roles[index]!.username,
          privileged: false,
          owner: false,
        });
      }
      await fixture.user.create({
        data: { id: actor.userId, githubLogin: actor.userId },
      });
      for (const id of [source, destination]) {
        await fixture.workspace.create({
          data: { id, slug: id, name: `Synthetic ${id}` },
        });
        await fixture.workspaceMember.create({
          data: { workspaceId: id, userId: actor.userId, role: "owner" },
        });
      }
      await fixture.repositoryConnection.create({
        data: {
          id: repository,
          workspaceId: destination,
          externalRepositoryId: repository,
          owner: "synthetic",
          name: repository,
          fullName: `synthetic/${repository}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
      service = await createPrismaReviewSkillsService({
        prisma: web,
        repositoryAccess: { authorizeRepositoryManagement: async () => [] },
      });
      admission = createPrismaReviewSkillsAdmission(api);
    });
    afterAll(async () => {
      await Promise.all([
        web?.$disconnect(),
        api?.$disconnect(),
        worker?.$disconnect(),
        fixture?.$disconnect(),
      ]);
      if (owner) {
        await owner.query("ROLLBACK");
        for (const role of roles) {
          if (
            (
              await owner.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [
                role.username,
              ])
            ).rowCount
          ) {
            await owner.query(`DROP OWNED BY ${quoted(role.username)}`);
            await owner.query(`DROP ROLE ${quoted(role.username)}`);
          }
        }
        await owner.end();
      }
    });
    const content = (name: string) => ({
      name,
      description: "Synthetic ACL proof",
      instructions: "Keep source content immutable.",
    });

    it("web manages exact feature mutations, API captures and prelocks, worker has no feature authority", async () => {
      const created = await service.createSkill({
        createOperationId: randomUUID(),
        actor,
        workspaceId: source,
        content: content("ACL original"),
      });
      const saved = await service.saveSkill({
        actor,
        workspaceId: source,
        skillId: created.skillId,
        expectedRevisionId: created.revisionId,
        content: content("ACL revision"),
      });
      const grant = await service.grantSkill({
        actor,
        sourceWorkspaceId: source,
        destinationWorkspaceId: destination,
        skillId: created.skillId,
      });
      await service.acceptSkillGrant({
        actor,
        destinationWorkspaceId: destination,
        skillId: created.skillId,
        expectedGrantVersion: grant.version,
      });
      await service.applyAssignments({
        actor,
        workspaceId: destination,
        repositoryIds: [repository],
        skillIds: [created.skillId],
        mode: "add",
      });
      const binding = (
        await service.loadRepositorySkillSettings({
          actor,
          workspaceId: destination,
          repositoryId: repository,
        })
      ).bindings.find((value) => value.skillId === created.skillId)!;
      await service.updateBindingScope({
        actor,
        workspaceId: destination,
        repositoryId: repository,
        skillId: created.skillId,
        expectedGeneration: binding.generation,
        expectedVersion: binding.version,
        scope: { includePaths: ["src/**"], excludePaths: [] },
      });
      await service.setRepositorySources({
        actor,
        workspaceId: destination,
        repositoryId: repository,
        expectedVersion: 0,
        roots: [".agents/skills"],
      });
      const candidate = await admission.capture({
        workspaceId: destination,
        repositoryConnectionId: repository,
        baseSha,
      });
      expect(candidate.webSkills[0]?.revisionId).toBe(saved.revisionId);
      expect(
        await api.$transaction(
          async (tx) => {
            expect(
              await admission.prelock(tx, {
                workspaceId: destination,
                candidate,
              }),
            ).toBe(true);
            return admission.matchesAdmission(tx, {
              workspaceId: destination,
              repositoryConnectionId: repository,
              baseSha,
              candidate,
            });
          },
          { isolationLevel: "Serializable" },
        ),
      ).toBe(true);
      await expect(
        api.$executeRaw`UPDATE "ReviewSkillBinding" SET version=version WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        api.$executeRaw`UPDATE "ReviewSkillRevision" SET name=name WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`UPDATE "ReviewSkill" SET "createOperationId"="createOperationId" WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`UPDATE "ReviewSkillBinding" SET generation=generation WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`UPDATE "ReviewSkillRevision" SET name=name WHERE id=${saved.revisionId}`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`DELETE FROM "ReviewSkill" WHERE id=${created.skillId}`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`UPDATE "RepositoryConnection" SET name=name WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        worker.$queryRaw`SELECT id FROM "ReviewSkill" LIMIT 1`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        worker.$executeRaw`INSERT INTO "ReviewSkillBinding" ("skillId") SELECT 'x' WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        api.$queryRaw`SELECT * FROM rr_review_skills_repository_lock(${destination}, ${[repository]}::text[])`,
      ).rejects.toThrow(/permission denied/);
      expect(
        await web.$queryRaw`SELECT * FROM rr_review_skills_repository_lock(${source}, ${[repository]}::text[])`,
      ).toEqual([]);
      expect(
        await web.$queryRaw`SELECT * FROM rr_review_skills_repository_lock(${destination}, ${Array.from({ length: 1001 }, () => repository)}::text[])`,
      ).toEqual([]);
      await service.applyAssignments({
        actor,
        workspaceId: destination,
        repositoryIds: [repository],
        skillIds: [created.skillId],
        mode: "remove",
      });
      await service.unlinkSkill({
        actor,
        destinationWorkspaceId: destination,
        skillId: created.skillId,
      });
      await service.revokeSkillGrant({
        actor,
        sourceWorkspaceId: source,
        destinationWorkspaceId: destination,
        skillId: created.skillId,
        expectedGrantVersion: grant.version,
      });
      await service.deleteSkill({
        actor,
        workspaceId: source,
        skillId: created.skillId,
      });
      await owner.query(reviewSkillsRuntimeGateStatements(roles));
      await expect(
        web.$executeRaw`UPDATE "ReviewSkill" SET "headRevisionId"="headRevisionId" WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await expect(
        web.$executeRaw`UPDATE "ReviewSkillBinding" SET version=version WHERE false`,
      ).rejects.toThrow(/permission denied/);
      await owner.query(reviewSkillsRuntimeGrantStatements(roles));
    });

    it("rejects a SERIALIZABLE snapshot established before waiting behind a committed revoke", async () => {
      const skill = await service.createSkill({
        createOperationId: randomUUID(),
        actor,
        workspaceId: source,
        content: content("Snapshot fence"),
      });
      const grant = await service.grantSkill({
        actor,
        sourceWorkspaceId: source,
        destinationWorkspaceId: destination,
        skillId: skill.skillId,
      });
      await service.acceptSkillGrant({
        actor,
        destinationWorkspaceId: destination,
        skillId: skill.skillId,
        expectedGrantVersion: grant.version,
      });
      await service.applyAssignments({
        actor,
        workspaceId: destination,
        repositoryIds: [repository],
        skillIds: [skill.skillId],
        mode: "add",
      });
      const candidate = await admission.capture({
        workspaceId: destination,
        repositoryConnectionId: repository,
        baseSha,
      });
      // Hold only the grant row. The real web mutation acquires and physically
      // updates the sorted parents, then blocks on this grant update.
      await owner.query("BEGIN");
      await owner.query(
        'SELECT "skillId" FROM "ReviewSkillGrant" WHERE "skillId"=$1 AND "destinationWorkspaceId"=$2 FOR UPDATE',
        [skill.skillId, destination],
      );
      const revoke = service.revokeSkillGrant({
        actor,
        sourceWorkspaceId: source,
        destinationWorkspaceId: destination,
        skillId: skill.skillId,
        expectedGrantVersion: grant.version,
      });
      let stale: Promise<unknown> | undefined;
      try {
        await waitForLock(roles[0]!.username);
        let snapshotEstablished!: () => void;
        const established = new Promise<void>((resolve) => {
          snapshotEstablished = resolve;
        });
        stale = api.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_current_snapshot()::text`;
            snapshotEstablished();
            return admission.prelock(tx, {
              workspaceId: destination,
              candidate,
            });
          },
          { isolationLevel: "Serializable", timeout: 10_000 },
        );
        const settled = stale.then(
          (value) => ({ status: "fulfilled" as const, value }),
          (error: unknown) => ({ status: "rejected" as const, error }),
        );
        await established;
        await waitForLock(roles[1]!.username);
        await owner.query("COMMIT");
        await revoke;
        const outcome = await settled;
        expect(outcome.status).toBe("rejected");
        if (outcome.status === "rejected")
          expect(outcome.error).toMatchObject({
            code: "P2010",
            meta: { driverAdapterError: { cause: { originalCode: "40001" } } },
          });
        await expect(
          admission.capture({
            workspaceId: destination,
            repositoryConnectionId: repository,
            baseSha,
          }),
        ).rejects.toMatchObject({ code: "unavailable" });
      } finally {
        await owner.query("ROLLBACK");
        await Promise.allSettled([revoke, stale]);
      }
    });
  },
);
