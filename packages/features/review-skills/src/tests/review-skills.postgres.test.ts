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
  it("reuses an exact creation intent across concurrent retries and later revisions", async () => {
    const createOperationId = randomUUID();
    const input = {
      actor: owner,
      workspaceId: b,
      createOperationId,
      content: content("  Exact creation retry  "),
    };
    const [first, concurrent] = await Promise.all([
      service.createSkill(input),
      service.createSkill(input),
    ]);
    expect(concurrent.skillId).toBe(first.skillId);
    expect(concurrent.revisionId).toBe(first.revisionId);
    expect(first.name).toBe("Exact creation retry");
    expect(
      await prisma.reviewSkill.count({ where: { createOperationId } }),
    ).toBe(1);
    expect(
      await prisma.reviewSkillRevision.count({
        where: { skillId: first.skillId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({
        where: { action: "review_skills.created", targetId: first.skillId },
      }),
    ).toBe(1);

    const saved = await service.saveSkill({
      actor: owner,
      workspaceId: b,
      skillId: first.skillId,
      expectedRevisionId: first.revisionId,
      content: content("Later canonical revision"),
    });
    const retried = await service.createSkill(input);
    expect(retried.skillId).toBe(first.skillId);
    expect(retried.revisionId).toBe(saved.revisionId);
    expect(retried.name).toBe(saved.name);
    await expect(
      service.createSkill({ ...input, content: content("Different intent") }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await prisma.reviewSkillRevision.count({
        where: { skillId: first.skillId },
      }),
    ).toBe(2);

    await service.deleteSkill({
      actor: owner,
      workspaceId: b,
      skillId: first.skillId,
    });
    await expect(service.createSkill(input)).rejects.toMatchObject({
      code: "unavailable",
    });
    expect(
      await prisma.reviewSkill.count({ where: { createOperationId } }),
    ).toBe(1);
  });

  it("scopes creation identities to the current author/workspace and rechecks replay authority", async () => {
    const user = { userId: `${prefix}-creation-retry-member` };
    await prisma.user.create({
      data: { id: user.userId, githubLogin: user.userId },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: b, userId: user.userId, role: "member" },
    });
    const createOperationId = randomUUID();
    const input = {
      workspaceId: b,
      createOperationId,
      content: content("Scoped creation retry"),
    };
    const original = await service.createSkill({ ...input, actor: owner });
    const otherAuthor = await service.createSkill({ ...input, actor: user });
    const otherWorkspace = await service.createSkill({
      ...input,
      actor: owner,
      workspaceId: c,
    });
    expect(
      new Set([original.skillId, otherAuthor.skillId, otherWorkspace.skillId])
        .size,
    ).toBe(3);
    await prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId: b, userId: user.userId } },
    });
    await expect(
      service.createSkill({ ...input, actor: user }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects a Paths CAS from an earlier assignment generation after remove and re-add", async () => {
    const repositoryId = `${prefix}-paths-generation`;
    await prisma.repositoryConnection.create({
      data: {
        id: repositoryId,
        workspaceId: b,
        externalRepositoryId: repositoryId,
        owner: "synthetic",
        name: repositoryId,
        fullName: `synthetic/${repositoryId}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    const skill = await service.createSkill({
      actor: owner,
      workspaceId: b,
      createOperationId: randomUUID(),
      content: content("Assignment generation"),
    });
    const assignment = {
      actor: owner,
      workspaceId: b,
      repositoryIds: [repositoryId],
      skillIds: [skill.skillId],
    };
    const load = async () =>
      (
        await service.loadRepositorySkillSettings({
          actor: owner,
          workspaceId: b,
          repositoryId,
        })
      ).bindings[0]!;
    await service.applyAssignments({
      ...assignment,
      mode: "add",
      scope: { includePaths: ["old/**"], excludePaths: [] },
    });
    const before = await load();
    await service.applyAssignments({ ...assignment, mode: "remove" });
    await service.applyAssignments({
      ...assignment,
      mode: "add",
      scope: { includePaths: ["new/**"], excludePaths: [] },
    });
    const recreated = await load();
    expect(recreated.version).toBe(before.version);
    expect(recreated.generation).not.toBe(before.generation);
    await expect(
      service.updateBindingScope({
        actor: owner,
        workspaceId: b,
        repositoryId,
        skillId: skill.skillId,
        expectedGeneration: before.generation,
        expectedVersion: before.version,
        scope: { includePaths: ["stale/**"], excludePaths: [] },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await load()).scope.includePaths).toEqual(["new/**"]);
    const saved = await service.updateBindingScope({
      actor: owner,
      workspaceId: b,
      repositoryId,
      skillId: skill.skillId,
      expectedGeneration: recreated.generation,
      expectedVersion: recreated.version,
      scope: { includePaths: ["current/**"], excludePaths: [] },
    });
    expect(saved.generation).toBe(recreated.generation);
    expect(saved.version).toBe(recreated.version + 1);
    expect(saved.scope.includePaths).toEqual(["current/**"]);
    await expect(
      service.updateBindingScope({
        actor: owner,
        workspaceId: b,
        repositoryId,
        skillId: skill.skillId,
        expectedGeneration: recreated.generation,
        expectedVersion: recreated.version,
        scope: { includePaths: ["stale-version/**"], excludePaths: [] },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("author-only CAS, immutable revisions, membership departure preserves consumption", async () => {
    const skill = await service.createSkill({
      createOperationId: randomUUID(),
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
      createOperationId: randomUUID(),
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
  it("retains privacy-safe unavailable links until local assignments and the link are removed", async () => {
    const skill = await service.createSkill({
      createOperationId: randomUUID(),
      actor: owner,
      workspaceId: a,
      content: content("Unavailable cleanup original"),
    });
    await link(skill.skillId);
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      skillIds: [skill.skillId],
      mode: "add",
    });
    await service.revokeSkillGrant({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
      expectedGrantVersion: 1,
    });
    const hiddenName = "Fresh source metadata must stay private";
    await service.saveSkill({
      actor: owner,
      workspaceId: a,
      skillId: skill.skillId,
      expectedRevisionId: skill.revisionId,
      content: {
        name: hiddenName,
        description: "Fresh private description",
        instructions: "Fresh private instructions",
      },
    });
    const library = await service.listWorkspaceSkills({
      actor: owner,
      workspaceId: b,
      search: skill.skillId,
    });
    expect(library.items).toEqual([
      {
        skillId: skill.skillId,
        available: false,
        linked: true,
        name: "Unavailable skill",
        unavailableReason: "unavailable",
        usedIn: [{ repositoryId: repos[0], name: `synthetic/${repos[0]}` }],
        canUnlink: true,
      },
    ]);
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: b,
          search: hiddenName,
        })
      ).items,
    ).toEqual([]);
    await expect(
      service.loadSkill({
        actor: owner,
        workspaceId: b,
        skillId: skill.skillId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    const targets = await service.listSkillRepositoryTargets({
      actor: owner,
      workspaceId: b,
      skillId: skill.skillId,
    });
    expect(targets.items.map((target) => target.repositoryId)).toEqual([
      repos[0],
    ]);
    expect(targets.items.every((target) => target.assigned)).toBe(true);
    await expect(
      service.unlinkSkill({
        actor: owner,
        destinationWorkspaceId: b,
        skillId: skill.skillId,
      }),
    ).rejects.toMatchObject({ code: "dependency_exists" });
    await expect(
      service.listWorkspaceSkills({ actor: writer, workspaceId: b }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.listSkillRepositoryTargets({
        actor: writer,
        workspaceId: b,
        skillId: skill.skillId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await prisma.workspaceMember.create({
      data: { workspaceId: b, userId: writer.userId, role: "member" },
    });
    try {
      expect(
        (
          await service.listWorkspaceSkills({
            actor: writer,
            workspaceId: b,
            search: skill.skillId,
          })
        ).items,
      ).toEqual([{ ...library.items[0], usedIn: [], canUnlink: false }]);
      const unprivileged = await createPrismaReviewSkillsService({
        prisma,
        repositoryAccess: {
          authorizeRepositoryManagement: async ({ repositoryIds }) =>
            repositoryIds.filter((id) => id === repos[1]),
        },
      });
      expect(
        (
          await unprivileged.listSkillRepositoryTargets({
            actor: writer,
            workspaceId: b,
            skillId: skill.skillId,
          })
        ).items,
      ).toEqual([]);
      expect(
        (
          await service.listSkillRepositoryTargets({
            actor: writer,
            workspaceId: b,
            skillId: skill.skillId,
          })
        ).items.map((target) => target.repositoryId),
      ).toEqual([repos[0]]);
      await expect(
        service.unlinkSkill({
          actor: writer,
          destinationWorkspaceId: b,
          skillId: skill.skillId,
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
    } finally {
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: b, userId: writer.userId },
      });
    }
    // A tombstone preserves the local cleanup path without exposing its head.
    await service.deleteSkill({
      actor: owner,
      workspaceId: a,
      skillId: skill.skillId,
    });
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: b,
          search: skill.skillId,
        })
      ).items,
    ).toEqual(library.items);
    const choices = await service.listAssignmentChoices({
      actor: writer,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      search: skill.skillId,
    });
    expect(choices.items.map((choice) => choice.skillId)).toEqual([
      skill.skillId,
    ]);
    await service.applyAssignments({
      actor: writer,
      workspaceId: b,
      repositoryIds: [repos[0]!],
      skillIds: [skill.skillId],
      mode: "remove",
    });
    expect(
      (
        await service.listSkillRepositoryTargets({
          actor: owner,
          workspaceId: b,
          skillId: skill.skillId,
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: b,
          search: skill.skillId,
        })
      ).items,
    ).toEqual([{ ...library.items[0], usedIn: [] }]);
    await service.unlinkSkill({
      actor: owner,
      destinationWorkspaceId: b,
      skillId: skill.skillId,
    });
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: b,
          search: skill.skillId,
        })
      ).items,
    ).toEqual([]);
    await expect(
      service.listSkillRepositoryTargets({
        actor: owner,
        workspaceId: b,
        skillId: skill.skillId,
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("paginates available and unavailable library entries in one canonical ID order", async () => {
    const destination = `${prefix}-pagination`;
    await prisma.workspace.create({
      data: {
        id: destination,
        slug: destination,
        name: "Pagination destination",
      },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: destination, userId: owner.userId, role: "owner" },
    });
    const ids = Array.from(
      { length: 53 },
      (_, n) => `${prefix}-page-${String(n).padStart(3, "0")}`,
    );
    // A bounded catalog fixture interleaves live links and revoked generations.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT INTO "ReviewSkill" ("id","sourceWorkspaceId","authorUserId","headRevisionId") SELECT value,${a},${owner.userId},value || '-revision' FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`;
      await tx.$executeRaw`INSERT INTO "ReviewSkillRevision" ("id","skillId","revisionNumber","name","description","instructions","contentDigest") SELECT value || '-revision',value,1,'Pagination fixture','','Review carefully.',${`sha256:${"0".repeat(64)}`} FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`;
      await tx.$executeRaw`INSERT INTO "ReviewSkillGrant" ("skillId","destinationWorkspaceId","grantedBy","version","revokedAt") SELECT value,${destination},${owner.userId},CASE WHEN ordinality % 2=0 THEN 1 ELSE 2 END,CASE WHEN ordinality % 2=0 THEN NULL ELSE CURRENT_TIMESTAMP END FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb) WITH ORDINALITY`;
      await tx.$executeRaw`INSERT INTO "ReviewSkillLink" ("workspaceId","skillId","acceptedGrantVersion","acceptedBy") SELECT ${destination},value,1,${owner.userId} FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)`;
    });
    const first = await service.listWorkspaceSkills({
      actor: owner,
      workspaceId: destination,
    });
    expect(first.items.map((entry) => entry.skillId)).toEqual(ids.slice(0, 50));
    expect(first.nextCursor).toBe(ids[49]);
    expect(first.items.filter((entry) => entry.available)).toHaveLength(25);
    const second = await service.listWorkspaceSkills({
      actor: owner,
      workspaceId: destination,
      cursor: first.nextCursor,
    });
    expect(second.items.map((entry) => entry.skillId)).toEqual(ids.slice(50));
    expect(second.nextCursor).toBeNull();
    const generic = await service.listWorkspaceSkills({
      actor: owner,
      workspaceId: destination,
      search: "Unavailable skill",
    });
    expect(generic.items.map((entry) => entry.skillId)).toEqual(
      ids.filter((_, n) => n % 2 === 0),
    );
    expect(generic.items.every((entry) => !entry.available)).toBe(true);
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: destination,
          search: ids[52]!,
        })
      ).items.map((entry) => entry.skillId),
    ).toEqual([ids[52]]);
    await expect(
      service.listWorkspaceSkills({
        actor: owner,
        workspaceId: destination,
        search: "x".repeat(201),
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    // A known created/reverse-selected skill must remain discoverable when its
    // human-readable name matches more entries than the first choices page.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`UPDATE "ReviewSkillGrant" SET "revokedAt"=NULL,"version"=3 WHERE "destinationWorkspaceId"=${destination}`;
      await tx.$executeRaw`UPDATE "ReviewSkillLink" SET "acceptedGrantVersion"=3 WHERE "workspaceId"=${destination}`;
    });
    const repositoryId = `${prefix}-pagination-repository`;
    await prisma.repositoryConnection.create({
      data: {
        id: repositoryId,
        workspaceId: destination,
        externalRepositoryId: repositoryId,
        owner: "synthetic",
        name: repositoryId,
        fullName: `synthetic/${repositoryId}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    const choicesInput = {
      actor: owner,
      workspaceId: destination,
      repositoryIds: [repositoryId],
    };
    const sameNamePage = await service.listAssignmentChoices({
      ...choicesInput,
      search: "Pagination fixture",
    });
    expect(sameNamePage.items.map((entry) => entry.skillId)).toEqual(
      ids.slice(0, 50),
    );
    expect(sameNamePage.nextCursor).toBe(ids[49]);
    const focusedId = ids[52]!;
    const focusedChoices = await service.listAssignmentChoices({
      ...choicesInput,
      search: focusedId,
    });
    expect(focusedChoices.items).toMatchObject([
      { skillId: focusedId, available: true, name: "Pagination fixture" },
    ]);
    expect(focusedChoices.items).toHaveLength(1);
    expect(focusedChoices.nextCursor).toBeNull();
    const focusedLibrary = await service.listWorkspaceSkills({
      actor: owner,
      workspaceId: destination,
      search: focusedId,
    });
    expect(focusedLibrary.items).toMatchObject([
      { skillId: focusedId, available: true, name: "Pagination fixture" },
    ]);
    expect(focusedLibrary.items).toHaveLength(1);
    await service.applyAssignments({
      ...choicesInput,
      skillIds: [focusedId],
      mode: "add",
    });
    const assigned = await service.listAssignmentChoices({
      ...choicesInput,
      assignedOnly: true,
    });
    expect(assigned.items.map((item) => item.skillId)).toEqual([focusedId]);
    expect(assigned.nextCursor).toBeNull();
    expect(
      (
        await service.listAssignmentChoices({
          ...choicesInput,
          assignedOnly: true,
          search: "does-not-match",
        })
      ).items,
    ).toEqual([]);
    await service.revokeSkillGrant({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: destination,
      skillId: focusedId,
      expectedGrantVersion: 3,
    });
    await service.saveSkill({
      actor: owner,
      workspaceId: a,
      skillId: focusedId,
      expectedRevisionId: `${focusedId}-revision`,
      content: content("Private renamed pagination skill"),
    });
    expect(
      (
        await service.listAssignmentChoices({
          ...choicesInput,
          search: focusedId,
        })
      ).items,
    ).toMatchObject([
      {
        skillId: focusedId,
        available: false,
        name: "Unavailable skill",
        description: null,
        sourceWorkspaceId: null,
        sourceWorkspaceName: null,
        authorName: null,
      },
    ]);
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: destination,
          search: focusedId,
        })
      ).items,
    ).toEqual([
      {
        skillId: focusedId,
        available: false,
        linked: true,
        name: "Unavailable skill",
        unavailableReason: "unavailable",
        usedIn: [{ repositoryId, name: `synthetic/${repositoryId}` }],
        canUnlink: true,
      },
    ]);
    expect(
      (
        await service.listAssignmentChoices({
          ...choicesInput,
          search: "Private renamed pagination skill",
        })
      ).items,
    ).toEqual([]);
    expect(
      (
        await service.listAssignmentChoices({
          ...choicesInput,
          assignedOnly: true,
        })
      ).items,
    ).toMatchObject([
      {
        skillId: focusedId,
        available: false,
        name: "Unavailable skill",
        sourceWorkspaceId: null,
        authorName: null,
      },
    ]);
    await expect(
      service.listAssignmentChoices({
        ...choicesInput,
        assignedOnly: true,
        repositoryIds: [repos[0]!],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    // Assigned pagination is independent of the first library page. A run may
    // select several repositories while each keeps its own 32-Skill limit.
    const secondRepositoryId = `${repositoryId}-second`;
    await prisma.repositoryConnection.create({
      data: {
        id: secondRepositoryId,
        workspaceId: destination,
        externalRepositoryId: secondRepositoryId,
        owner: "synthetic",
        name: secondRepositoryId,
        fullName: `synthetic/${secondRepositoryId}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    await service.applyAssignments({
      ...choicesInput,
      skillIds: ids.slice(0, 26),
      mode: "add",
    });
    await service.applyAssignments({
      ...choicesInput,
      repositoryIds: [secondRepositoryId],
      skillIds: ids.slice(26, 52),
      mode: "add",
    });
    const allAssignedInput = {
      ...choicesInput,
      repositoryIds: [repositoryId, secondRepositoryId],
      assignedOnly: true,
    };
    const assignedFirst = await service.listAssignmentChoices(allAssignedInput);
    expect(assignedFirst.items.map((item) => item.skillId)).toEqual(
      ids.slice(0, 50),
    );
    expect(assignedFirst.nextCursor).toBe(ids[49]);
    const assignedSecond = await service.listAssignmentChoices({
      ...allAssignedInput,
      cursor: assignedFirst.nextCursor,
    });
    expect(assignedSecond.items.map((item) => item.skillId)).toEqual(
      ids.slice(50),
    );
    expect(assignedSecond.nextCursor).toBeNull();
    expect(
      (
        await service.listWorkspaceSkills({
          actor: owner,
          workspaceId: destination,
          search: "Private renamed pagination skill",
        })
      ).items,
    ).toEqual([]);
  });
  it("lets only current workspace admins remove retained bindings from inactive local repositories", async () => {
    const localRepos = ["archived", "unselected", "active", "unassigned"].map(
      (state) => `${prefix}-cleanup-${state}`,
    );
    const foreign = `${prefix}-cleanup-foreign`;
    for (const id of [...localRepos, foreign])
      await prisma.repositoryConnection.create({
        data: {
          id,
          workspaceId: id === foreign ? a : b,
          externalRepositoryId: id,
          owner: "synthetic",
          name: id,
          fullName: `synthetic/${id}`,
          defaultBranch: "main",
          visibility: "private",
        },
      });
    const original = await service.createSkill({
      createOperationId: randomUUID(),
      actor: owner,
      workspaceId: b,
      content: content("Inactive local original"),
    });
    const shared = await service.createSkill({
      createOperationId: randomUUID(),
      actor: owner,
      workspaceId: a,
      content: content("Inactive shared link"),
    });
    await link(shared.skillId);
    const assigned = localRepos.slice(0, 3);
    const skillIds = [original.skillId, shared.skillId];
    await service.applyAssignments({
      actor: owner,
      workspaceId: b,
      repositoryIds: assigned,
      skillIds,
      mode: "add",
    });
    await prisma.repositoryConnection.update({
      where: { id: localRepos[0]! },
      data: { archived: true },
    });
    await prisma.repositoryConnection.update({
      where: { id: localRepos[1]! },
      data: { selected: false },
    });
    await prisma.repositoryConnection.update({
      where: { id: localRepos[3]! },
      data: { archived: true },
    });
    await service.revokeSkillGrant({
      actor: owner,
      sourceWorkspaceId: a,
      destinationWorkspaceId: b,
      skillId: shared.skillId,
      expectedGrantVersion: 1,
    });
    const originalTargets = (
      await service.listSkillRepositoryTargets({
        actor: owner,
        workspaceId: b,
        skillId: original.skillId,
      })
    ).items;
    expect(
      originalTargets
        .filter((target) => assigned.includes(target.repositoryId))
        .map(({ repositoryId, active, assigned }) => ({
          repositoryId,
          active,
          assigned,
        })),
    ).toEqual(
      assigned
        .map((repositoryId, index) => ({
          repositoryId,
          active: index === 2,
          assigned: true,
        }))
        .sort((left, right) =>
          left.repositoryId < right.repositoryId ? -1 : 1,
        ),
    );
    expect(
      originalTargets.some(
        (target) =>
          target.repositoryId === localRepos[3] ||
          target.repositoryId === foreign,
      ),
    ).toBe(false);
    expect(
      (
        await service.listSkillRepositoryTargets({
          actor: owner,
          workspaceId: b,
          skillId: shared.skillId,
        })
      ).items.map((target) => target.repositoryId),
    ).toEqual([...assigned].sort());
    expect(
      (
        await service.listAssignmentChoices({
          actor: owner,
          workspaceId: b,
          repositoryIds: assigned,
        })
      ).items
        .filter((choice) => skillIds.includes(choice.skillId))
        .map((choice) => choice.assignedCount),
    ).toEqual([3, 3]);
    const countBindings = async () =>
      Number(
        (
          await prisma.$queryRaw<
            readonly { count: bigint }[]
          >`SELECT count(*) FROM "ReviewSkillBinding" WHERE "skillId" IN (${original.skillId},${shared.skillId})`
        )[0]?.count,
      );
    await expect(
      service.applyAssignments({
        actor: owner,
        workspaceId: b,
        repositoryIds: [localRepos[0]!, foreign],
        skillIds,
        mode: "remove",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await countBindings()).toBe(6);
    await expect(
      service.applyAssignments({
        actor: owner,
        workspaceId: b,
        repositoryIds: [localRepos[0]!],
        skillIds: [original.skillId],
        mode: "add",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.updateBindingScope({
        actor: owner,
        workspaceId: b,
        repositoryId: localRepos[0]!,
        skillId: original.skillId,
        expectedGeneration: randomUUID(),
        expectedVersion: 1,
        scope: { includePaths: ["src/**"], excludePaths: [] },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.setRepositorySources({
        actor: owner,
        workspaceId: b,
        repositoryId: localRepos[1]!,
        expectedVersion: 0,
        roots: [".agents/skills"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const scmWriter = await createPrismaReviewSkillsService({
      prisma,
      repositoryAccess: {
        authorizeRepositoryManagement: async ({ repositoryIds }) =>
          repositoryIds,
      },
    });
    await expect(
      scmWriter.listAssignmentChoices({
        actor: writer,
        workspaceId: b,
        repositoryIds: assigned,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scmWriter.applyAssignments({
        actor: writer,
        workspaceId: b,
        repositoryIds: assigned,
        skillIds,
        mode: "remove",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await countBindings()).toBe(6);
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
          repositoryIds: assigned,
          skillIds,
          mode: "remove",
        }),
      ).rejects.toMatchObject({ code: "forbidden" });
      const memberTargets = await scmWriter.listSkillRepositoryTargets({
        actor: owner,
        workspaceId: b,
        skillId: original.skillId,
      });
      expect(
        memberTargets.items.some(
          (target) =>
            target.repositoryId === localRepos[0] ||
            target.repositoryId === localRepos[1],
        ),
      ).toBe(false);
      expect(await countBindings()).toBe(6);
    } finally {
      await prisma.workspaceMember.updateMany({
        where: { workspaceId: b, userId: owner.userId },
        data: { role: "owner" },
      });
    }
    expect(
      (
        await service.applyAssignments({
          actor: owner,
          workspaceId: b,
          repositoryIds: assigned,
          skillIds,
          mode: "remove",
        })
      ).removed,
    ).toBe(6);
    expect(
      (
        await service.listSkillRepositoryTargets({
          actor: owner,
          workspaceId: b,
          skillId: shared.skillId,
        })
      ).items,
    ).toEqual([]);
    await service.unlinkSkill({
      actor: owner,
      destinationWorkspaceId: b,
      skillId: shared.skillId,
    });
    await service.deleteSkill({
      actor: owner,
      workspaceId: b,
      skillId: original.skillId,
    });
    await service.deleteSkill({
      actor: owner,
      workspaceId: a,
      skillId: shared.skillId,
    });
  });
  it("bulk delta preserves unrelated scopes, rolls back forbidden selection, CAS source settings", async () => {
    const one = await service.createSkill({
      createOperationId: randomUUID(),
      actor: owner,
      workspaceId: b,
      content: content("One"),
    });
    const two = await service.createSkill({
      createOperationId: randomUUID(),
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
      createOperationId: randomUUID(),
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
      createOperationId: randomUUID(),
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
      repositoryAccess: {
        authorizeRepositoryManagement: async () => [repos[0]!],
      },
    });
    await prisma.workspaceMember.create({
      data: { workspaceId: b, userId: author.userId, role: "member" },
    });
    try {
      const targets = await lost.listSkillRepositoryTargets({
        actor: author,
        workspaceId: b,
        skillId: skill.skillId,
      });
      expect(targets.items.map((target) => target.repositoryId)).toEqual([
        repos[0],
      ]);
    } finally {
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: b, userId: author.userId },
      });
    }
    await expect(
      lost.applyAssignments({
        actor: writer,
        workspaceId: b,
        repositoryIds: repos,
        skillIds: [skill.skillId],
        mode: "add",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const partialRows = await prisma.$queryRaw<
      readonly { count: bigint }[]
    >`SELECT count(*) FROM "ReviewSkillBinding" WHERE "skillId"=${skill.skillId}`;
    expect(Number(partialRows[0]?.count)).toBe(0);
  });
  it("opposite-direction dual-admin sharing uses the same sorted workspace order", async () => {
    const left = await service.createSkill({
      createOperationId: randomUUID(),
      actor: owner,
      workspaceId: a,
      content: content("Left"),
    });
    const right = await service.createSkill({
      createOperationId: randomUUID(),
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
            createOperationId: randomUUID(),
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
      createOperationId: randomUUID(),
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
