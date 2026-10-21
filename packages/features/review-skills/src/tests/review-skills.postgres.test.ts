import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaReviewSkillsAdmission,
  createPrismaReviewSkillsService,
} from "../composition/index.js";
import type { ReviewSkillsService } from "../application/contracts.js";
import type { Client } from "pg";
import { claimReviewSkillsPostgresFixture } from "./postgres-fixture.js";
const url = process.env.REVIEW_SKILLS_TEST_DATABASE_URL;
if (!url && process.env.REVIEW_SKILLS_REQUIRE_PG === "1")
  throw new Error("review_skills_required_postgresql_missing");
describe.skipIf(!url)("Review Skills real PostgreSQL atomic boundaries", () => {
  const prefix = `skills-${randomUUID()}`,
    a = `${prefix}-a`,
    b = `${prefix}-b`,
    c = `${prefix}-c`;
  const owner = { userId: `${prefix}-owner` },
    author = { userId: `${prefix}-author` },
    writer = { userId: `${prefix}-writer` };
  const repos = [`${prefix}-repo1`, `${prefix}-repo2`],
    baseSha = "a".repeat(40);
  let prisma: PrismaClient,
    service: ReviewSkillsService,
    admission: ReturnType<typeof createPrismaReviewSkillsAdmission>;
  let fixtureClaim: Client;
  beforeAll(async () => {
    fixtureClaim = await claimReviewSkillsPostgresFixture(url!);
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    const version = await prisma.$queryRaw<
      readonly { server_version_num: string }[]
    >`SHOW server_version_num`;
    expect(Number(version[0]?.server_version_num)).toBeGreaterThanOrEqual(
      170000,
    );
    for (const user of [owner, author, writer])
      await prisma.user.create({
        data: { id: user.userId, githubLogin: user.userId },
      });
    for (const id of [a, b, c]) {
      await prisma.workspace.create({
        data: { id, slug: id, name: `Synthetic ${id}` },
      });
      await prisma.workspaceMember.create({
        data: { workspaceId: id, userId: owner.userId, role: "owner" },
      });
    }
    await prisma.workspaceMember.create({
      data: { workspaceId: a, userId: author.userId, role: "member" },
    });
    for (const id of repos)
      await prisma.repositoryConnection.create({
        data: {
          id,
          workspaceId: b,
          externalRepositoryId: id,
          owner: "synthetic",
          name: id,
          fullName: `synthetic/${id}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
    service = await createPrismaReviewSkillsService({
      prisma,
      repositoryAccess: {
        authorizeRepositoryManagement: async (i) =>
          i.actor.userId === writer.userId
            ? i.repositoryIds.filter((id) => repos.includes(id))
            : [],
      },
    });
    admission = createPrismaReviewSkillsAdmission(prisma);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await fixtureClaim?.end();
  });
  const content = (name: string) => ({
    name,
    description: "Synthetic policy",
    instructions: "Review the supplied code carefully.",
  });
  const link = async (skillId: string, sourceWorkspaceId = a) =>
    service.linkSkillAsDualAdmin({
      actor: owner,
      sourceWorkspaceId,
      destinationWorkspaceId: b,
      skillId,
    });
  it("author-only CAS, immutable revisions, membership departure preserves consumption", async () => {
    const skill = await service.createSkill({
      actor: author,
      workspaceId: a,
      content: content("Author skill"),
    });
    await expect(
      service.saveSkill({
        actor: owner,
        workspaceId: a,
        skillId: skill.skillId,
        expectedRevisionId: skill.revisionId,
        content: content("Takeover"),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const attempts = await Promise.allSettled(
      ["First", "Second"].map((name) =>
        service.saveSkill({
          actor: author,
          workspaceId: a,
          skillId: skill.skillId,
          expectedRevisionId: skill.revisionId,
          content: content(name),
        }),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
    await expect(
      prisma.$executeRaw`UPDATE "ReviewSkillRevision" SET name='tampered' WHERE id=${skill.revisionId}`,
    ).rejects.toThrow(/immutable/);
    await link(skill.skillId);
    await service.applyAssignments({
      actor: writer,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      skillIds: [skill.skillId],
      mode: "add",
    });
    await prisma.workspaceMember.deleteMany({
      where: { workspaceId: a, userId: author.userId },
    });
    const current = await admission.capture({
      workspaceId: b,
      repositoryConnectionId: repos[0]!,
      baseSha,
    });
    expect(
      current.webSkills.find((s) => s.skillId === skill.skillId)?.revisionId,
    ).not.toBe(skill.revisionId);
    await expect(
      service.saveSkill({
        actor: author,
        workspaceId: a,
        skillId: skill.skillId,
        expectedRevisionId: current.webSkills[0]!.revisionId,
        content: content("After leaving"),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.loadSkill({
        actor: writer,
        workspaceId: b,
        skillId: skill.skillId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const choices = await service.listAssignmentChoices({
      actor: writer,
      workspaceId: b,
      repositoryIds: [repos[0]!],
    });
    expect(
      choices.items.find((s) => s.skillId === skill.skillId)?.assignedCount,
    ).toBe(1);
  });
  it("grant generations fence stale accept and revoked metadata, existing captured bytes stay stable", async () => {
    const skill = await service.createSkill({
      actor: owner,
      workspaceId: a,
      content: content("Original secret label"),
    });
    const grant = await service.grantSkill({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
    });
    await service.acceptSkillGrant({
      actor: owner,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
      expectedGrantVersion: grant.version,
    });
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[1]!],
      skillIds: [skill.skillId],
      mode: "add",
    });
    const captured = await admission.capture({
        workspaceId: b,
        repositoryConnectionId: repos[1]!,
        baseSha,
      }),
      bytes = JSON.stringify(captured);
    await service.revokeSkillGrant({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
      expectedGrantVersion: grant.version,
    });
    await service.saveSkill({
      actor: owner,
      workspaceId: a,
      skillId: skill.skillId,
      expectedRevisionId: skill.revisionId,
      content: content("New hidden label"),
    });
    await expect(
      admission.capture({
        workspaceId: b,
        repositoryConnectionId: repos[1]!,
        baseSha,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const choice = (
      await service.listAssignmentChoices({
        actor: owner,
        workspaceId: b,
        repositoryIds: [repos[1]!],
      })
    ).items.find((s) => s.skillId === skill.skillId)!;
    expect(choice).toMatchObject({
      available: false,
      name: "Unavailable skill",
      description: null,
      sourceWorkspaceName: null,
    });
    expect(JSON.stringify(captured)).toBe(bytes);
    const regrant = await service.grantSkill({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
    });
    expect(regrant.version).toBe(grant.version + 2);
    await expect(
      service.acceptSkillGrant({
        actor: owner,
        destinationWorkspaceId: b,
        skillId: skill.skillId,
        expectedGrantVersion: grant.version,
      }),
    ).rejects.toMatchObject({ code: "stale_grant" });
    await service.acceptSkillGrant({
      actor: owner,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
      expectedGrantVersion: regrant.version,
    });
    expect(
      (
        await admission.capture({
          workspaceId: b,
          repositoryConnectionId: repos[1]!,
          baseSha,
        })
      ).webSkills.find((s) => s.skillId === skill.skillId)?.name,
    ).toBe("New hidden label");
  });
  it("bulk delta preserves unrelated scopes, rolls back forbidden selection, CAS source settings", async () => {
    const one = await service.createSkill({
      actor: owner,
      workspaceId: b,
      content: content("One"),
    });
    const two = await service.createSkill({
      actor: owner,
      workspaceId: b,
      content: content("Two"),
    });
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      skillIds: [one.skillId],
      mode: "add",
      scope: { includePaths: ["src/**"], excludePaths: [] },
    });
    const delta = await service.applyAssignments({
      actor: writer,
      workspaceId: b,
      repositoryIds: repos,
      skillIds: [one.skillId, two.skillId],
      mode: "add",
    });
    expect(delta.added).toBe(3);
    expect(delta.unchanged).toBe(1);
    expect(
      (
        await service.loadRepositorySkillSettings({
          actor: writer,
          workspaceId: b,
          repositoryId: repos[0]!,
        })
      ).bindings.find((x) => x.skillId === one.skillId)?.scope.includePaths,
    ).toEqual(["src/**"]);
    await expect(
      service.applyAssignments({
        actor: writer,
        workspaceId: b,
        repositoryIds: [repos[0]!, `${prefix}-foreign`],
        skillIds: [two.skillId],
        mode: "remove",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      (
        await service.loadRepositorySkillSettings({
          actor: writer,
          workspaceId: b,
          repositoryId: repos[0]!,
        })
      ).bindings.some((x) => x.skillId === two.skillId),
    ).toBe(true);
    const removed = await service.applyAssignments({
      actor: writer,
      workspaceId: b,
      repositoryIds: repos,
      skillIds: [two.skillId],
      mode: "remove",
    });
    expect(removed.removed).toBe(2);
    expect(
      (
        await service.applyAssignments({
          actor: writer,
          workspaceId: b,
          repositoryIds: repos,
          skillIds: [two.skillId],
          mode: "remove",
        })
      ).removed,
    ).toBe(0);
    const settings = await service.setRepositorySources({
      actor: writer,
      workspaceId: b,
      repositoryId: repos[0]!,
      expectedVersion: 0,
      roots: [".agents/skills"],
    });
    expect(settings.sourceVersion).toBe(1);
    await expect(
      service.setRepositorySources({
        actor: writer,
        workspaceId: b,
        repositoryId: repos[0]!,
        expectedVersion: 0,
        roots: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("new source after candidate capture yields changed facts without out-of-order locking", async () => {
    const before = await admission.capture({
      workspaceId: b,
      repositoryConnectionId: repos[0]!,
      baseSha,
    });
    const skill = await service.createSkill({
      actor: owner,
      workspaceId: c,
      content: content("Third source"),
    });
    await link(skill.skillId, c);
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      skillIds: [skill.skillId],
      mode: "add",
    });
    const matched = await prisma.$transaction(
      async (tx) => {
        expect(
          await admission.prelock(tx, { workspaceId: b, candidate: before }),
        ).toBe(true);
        return admission.matchesAdmission(tx, {
          workspaceId: b,
          repositoryConnectionId: repos[0]!,
          baseSha,
          candidate: before,
        });
      },
      { isolationLevel: "Serializable" },
    );
    expect(matched).toBe(false);
  });
  it("rechecks DB admin after preflight and rejects lost SCM proof without partial writes", async () => {
    const skill = await service.createSkill({
      actor: owner,
      workspaceId: b,
      content: content("Demotion guard"),
    });
    const demoted = await createPrismaReviewSkillsService({
      prisma,
      repositoryAccess: {
        authorizeRepositoryManagement: async () => {
          await prisma.workspaceMember.updateMany({
            where: { workspaceId: b, userId: owner.userId },
            data: { role: "member" },
          });
          return [];
        },
      },
    });
    try {
      await expect(
        demoted.applyAssignments({
          actor: owner,
          workspaceId: b,
          repositoryIds: repos,
          skillIds: [skill.skillId],
          mode: "add",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      const rows = await prisma.$queryRaw<
        readonly { count: bigint }[]
      >`SELECT count(*) FROM "ReviewSkillBinding" WHERE "skillId"=${skill.skillId}`;
      expect(Number(rows[0]?.count)).toBe(0);
    } finally {
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: b, userId: owner.userId },
        data: { role: "owner" },
      });
    }
    const lost = await createPrismaReviewSkillsService({
      prisma,
      repositoryAccess: { authorizeRepositoryManagement: async () => [] },
    });
    await expect(
      lost.applyAssignments({
        actor: writer,
        workspaceId: b,
        repositoryIds: repos,
        skillIds: [skill.skillId],
        mode: "add",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("opposite-direction dual-admin sharing uses the same sorted workspace order", async () => {
    const left = await service.createSkill({
      actor: owner,
      workspaceId: a,
      content: content("Left"),
    });
    const right = await service.createSkill({
      actor: owner,
      workspaceId: b,
      content: content("Right"),
    });
    const linked = await Promise.all([
      service.linkSkillAsDualAdmin({
        actor: owner,
        sourceWorkspaceId: a,
        destinationWorkspaceId: b,
        skillId: left.skillId,
      }),
      service.linkSkillAsDualAdmin({
        actor: owner,
        sourceWorkspaceId: b,
        destinationWorkspaceId: a,
        skillId: right.skillId,
      }),
    ]);
    expect(linked.every((x) => x.active)).toBe(true);
  });
  it("bounded capture refuses oversized whole bundle rather than truncating instructions", async () => {
    const large = [];
    for (let n = 0; n < 9; n++)
      large.push(
        (
          await service.createSkill({
            actor: owner,
            workspaceId: b,
            content: {
              name: `Large ${n}`,
              description: "",
              instructions: "x".repeat(32768),
            },
          })
        ).skillId,
      );
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[1]!],
      skillIds: large,
      mode: "add",
    });
    await expect(
      admission.capture({
        workspaceId: b,
        repositoryConnectionId: repos[1]!,
        baseSha,
      }),
    ).rejects.toMatchObject({ code: "limit_exceeded" });
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[1]!],
      skillIds: large,
      mode: "remove",
    });
  });
  it("unavailable source workspace does not prevent removal of the stale local assignment", async () => {
    const skill = await service.createSkill({
      actor: owner,
      workspaceId: c,
      content: content("Retired source"),
    });
    await link(skill.skillId, c);
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[1]!],
      skillIds: [skill.skillId],
      mode: "add",
    });
    await prisma.workspace.update({
      where: { id: c },
      data: { deletionState: "delete_pending" },
    });
    try {
      await expect(
        admission.capture({
          workspaceId: b,
          repositoryConnectionId: repos[1]!,
          baseSha,
        }),
      ).rejects.toMatchObject({ code: "unavailable" });
      expect(
        (
          await service.applyAssignments({
            actor: writer,
            workspaceId: b,
            repositoryIds: [repos[1]!],
            skillIds: [skill.skillId],
            mode: "remove",
          })
        ).removed,
      ).toBe(1);
    } finally {
      await prisma.workspace.update({
        where: { id: c },
        data: { deletionState: "active" },
      });
    }
  });
});
