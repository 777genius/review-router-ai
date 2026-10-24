import { createHash } from "node:crypto";
import pg from "pg";
import { FIXTURES } from "./contracts.ts";
import { SKILLS_MANAGER_EXTERNAL_ID } from "./skills-github-fixture.ts";
export const SKILLS_SHARED_ID = "rr-e2e-skill-shared";
export async function seedSkillsFixtures(databaseUrl: string) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    // The role-free migration fixture retains its synthetic table owner; the
    // NOLOGIN canonical helper owner needs the same narrow row-lock authority.
    await db.query(
      `GRANT SELECT, UPDATE(id) ON TABLE public."RepositoryConnection" TO reviewrouter_release_schema_owner`,
    );
    await db.query(
      `UPDATE "GitHubInstallation" SET status='active' WHERE id IN ('rr-e2e-install-personal-viewer','rr-e2e-install-alpha-suspended')`,
    );
    await db.query(
      `UPDATE "UserExternalIdentity" SET "externalUserId"=$1 WHERE "userId"=$2 AND provider='github'`,
      [SKILLS_MANAGER_EXTERNAL_ID, FIXTURES.users.foreign],
    );
    for (const [workspaceId, owner, installationId, count] of [
      [
        FIXTURES.workspaces.personalViewer,
        "rr-e2e-viewer",
        "rr-e2e-install-personal-viewer",
        125,
      ],
      [
        FIXTURES.workspaces.orgAlpha,
        "rr-e2e-org-alpha",
        "rr-e2e-install-alpha-suspended",
        2,
      ],
    ] as const) {
      for (let index = 1; index <= count; index++) {
        const suffix = String(index).padStart(3, "0");
        const id = `rr-e2e-repo-${owner}-${suffix}`;
        await db.query(
          `INSERT INTO "RepositoryConnection" (id,"workspaceId",provider,"externalRepositoryId","installationId","githubRepositoryId",owner,name,"fullName","defaultBranch",visibility,selected,archived,"updatedAt") VALUES ($1,$2,'github',$3,$4,$5,$6,$7,$8,'main','private',true,false,CURRENT_TIMESTAMP)`,
          [
            id,
            workspaceId,
            `${owner}-${suffix}`,
            installationId,
            (workspaceId === FIXTURES.workspaces.personalViewer
              ? 930000000000
              : 940000000000) + index,
            owner,
            `skills-project-${suffix}`,
            `${owner}/skills-project-${suffix}`,
          ],
        );
      }
      await db.query(
        `INSERT INTO "ReviewConfiguration" (id,"workspaceId","targetKey","updatedAt") VALUES ($1,$2,'workspace:default',CURRENT_TIMESTAMP)`,
        [`rr-e2e-review-config-${owner}`, workspaceId],
      );
      // A schema 4 workspace document with built-in settings and no default
      // provider: Skills need a readable review configuration, not a provider.
      const policy = {
        schemaVersion: 4,
        execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 50, targetTokensPerBatch: 50000 },
        reviewLanguage: null,
        investigationRollout: {
          recordingEnabled: false,
          shadowEnabled: false,
          contextCriticEnabled: false,
          verifiedCleanEnabled: false,
          crossRevisionReplayEnabled: false,
          productionEffectsEnabled: false,
        },
      };
      await db.query(
        `INSERT INTO "ReviewConfigurationVersion" (id,"configurationId","workspaceId",version,"schemaVersion","policyJson") VALUES ($1,$2,$3,1,4,$4)`,
        [
          `rr-e2e-review-config-version-${owner}`,
          `rr-e2e-review-config-${owner}`,
          workspaceId,
          JSON.stringify(policy),
        ],
      );
    }
    await db.query(
      `INSERT INTO "RepositoryPermissionCache" (id,"userId","repositoryId","githubInstallationId",permission,"roleName","canManage","checkedAt","expiresAt","updatedAt") VALUES ('rr-e2e-skills-writer-permission',$1,'rr-e2e-repo-rr-e2e-org-alpha-001',920000000001,'write','write',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+interval '4 hours',CURRENT_TIMESTAMP)`,
      [FIXTURES.users.foreign],
    );
    for (let index = 1; index <= 61; index++) {
      const suffix = String(index).padStart(3, "0");
      const id = index === 61 ? SKILLS_SHARED_ID : `rr-e2e-skill-${suffix}`;
      const name =
        index === 61 ? "Canonical shared skill" : `Fixture skill ${suffix}`;
      const content = {
        name,
        description: `Synthetic Skills browser fixture ${suffix}`,
        instructions: `Check fixture policy ${suffix}. Do not modify credentials.`,
      };
      const digest = `sha256:${createHash("sha256").update(JSON.stringify(content)).digest("hex")}`;
      await db.query(
        `INSERT INTO "ReviewSkill" (id,"sourceWorkspaceId","authorUserId","headRevisionId") VALUES ($1,$2,$3,$4)`,
        [
          id,
          FIXTURES.workspaces.personalViewer,
          FIXTURES.users.viewer,
          `${id}-revision-1`,
        ],
      );
      await db.query(
        `INSERT INTO "ReviewSkillRevision" (id,"skillId","revisionNumber",name,description,instructions,"contentDigest") VALUES ($1,$2,1,$3,$4,$5,$6)`,
        [
          `${id}-revision-1`,
          id,
          content.name,
          content.description,
          content.instructions,
          digest,
        ],
      );
    }
    await db.query(
      `INSERT INTO "ReviewSkillGrant" ("skillId","destinationWorkspaceId","grantedBy") VALUES ($1,$2,$3)`,
      [SKILLS_SHARED_ID, FIXTURES.workspaces.orgAlpha, FIXTURES.users.viewer],
    );
    await db.query(
      `INSERT INTO "ReviewSkillLink" ("workspaceId","skillId","acceptedGrantVersion","acceptedBy") VALUES ($1,$2,1,$3)`,
      [FIXTURES.workspaces.orgAlpha, SKILLS_SHARED_ID, FIXTURES.users.viewer],
    );
    for (const [repositoryId, skillId] of [
      ["rr-e2e-repo-rr-e2e-viewer-001", "rr-e2e-skill-001"],
      ["rr-e2e-repo-rr-e2e-org-alpha-002", SKILLS_SHARED_ID],
    ] as const)
      await db.query(
        `INSERT INTO "ReviewSkillBinding" ("workspaceId","repositoryConnectionId","skillId","includePaths","excludePaths") VALUES ($1,$2,$3,'["**"]','[]')`,
        [
          repositoryId.includes("org-alpha")
            ? FIXTURES.workspaces.orgAlpha
            : FIXTURES.workspaces.personalViewer,
          repositoryId,
          skillId,
        ],
      );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}
