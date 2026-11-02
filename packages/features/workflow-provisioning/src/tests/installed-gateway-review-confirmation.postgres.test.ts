import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrismaClient } from "@reviewrouter/platform-db";
import {
  ManageReviewSafetyControls,
  ManageScmRepositoryIdentities,
  ReviewSafetyPolicyScope,
  ReviewSafetyRolloutMode,
  ScmProvider,
} from "@reviewrouter/features-review-run-control";
import { createPrismaReviewRunControlRepositories } from "@reviewrouter/features-review-run-control/composition";
import {
  reviewActionV2CanonicalizerDigest,
  reviewActionV2PublishedSchemaDigest,
} from "@reviewrouter/protocol-review-action-v2";
import { releaseCandidate } from "../../../review-run-control/src/tests/fixtures";
import {
  workspacePolicyFixture,
  workspacePolicyDocumentFixture,
} from "../../../review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { renderAccountGatewayWorkflow } from "../domain/workflow-template";
import { gatewayReviewV2SafetyCapabilities } from "../application/provision-gateway-review-v2-repository";
import { createInstalledGatewayReviewConfirmation } from "../infrastructure/prisma/prisma-installed-gateway-review-confirmation";

// Only external GitHub transport is substituted. The factory, policy/binding
// reads, producer materialization, proof collection, authority/core5 commands,
// setup CAS and audit adapters all run unchanged against a nonowner API login.
const github = vi.hoisted(() => ({ request: vi.fn(), auth: vi.fn() }));
vi.mock("@octokit/app", () => ({
  App: class {
    octokit = { auth: github.auth };
    async getInstallationOctokit() {
      return { request: github.request };
    }
  },
}));
vi.mock("@octokit/request", () => ({ request: github.request }));

const adminUrl = process.env.WORKFLOW_OPERATOR_TEST_POSTGRES_ADMIN_URL;
const action = releaseCandidate.actionCommitSha,
  head = "b".repeat(40),
  blob = "c".repeat(40);
const profileRef = "openrouter-openai-responses-apikey-v1";
const env = {
  GITHUB_APP_ID: "42",
  GITHUB_APP_PRIVATE_KEY: "fixture-key-not-used-by-mocked-github",
  REVIEW_ROUTER_PUBLIC_API_URL: "https://reviewrouter.example",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF: `777genius/review-router@${action}`,
  REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${"e".repeat(40)}`,
  REVIEW_ROUTER_REVIEW_V2_WORKER_ENABLED: "1",
  REVIEW_ROUTER_REVIEW_V2_DIRECT_INITIALIZATION_ENABLED: "1",
  REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify([
    {
      ...releaseCandidate,
      schemaDigest: reviewActionV2PublishedSchemaDigest,
      canonicalizerDigest: reviewActionV2CanonicalizerDigest,
      contextGatewayPolicyVersion: null,
      contextGatewayEntrypointDigest: null,
    },
  ]),
};
const command = {
  workspaceId: "operator-workspace",
  repositoryId: "operator-repository",
  actor: "reviewrouter-operator",
  operatorAudit: {
    operatorId: "reviewrouter-operator",
    ownerUserId: "operator-owner",
  },
};

// Dedicated COLD PG17 only. Never consult application DATABASE_URL, and never
// run beside another migration suite: the retained authority roles are global.
describe.skipIf(!adminUrl)(
  "installed Gateway confirmation: real PostgreSQL API role",
  () => {
    const dbName = "TEST_operator_gateway_" + randomUUID().replaceAll("-", "");
    let admin: PrismaClient,
      api: PrismaClient,
      databaseCreated = false;
    let scratch: string | undefined;
    let scmId: string;
    function sql(url: string, input: string) {
      return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-At"], {
        input,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
      });
    }
    beforeAll(async () => {
      const root = new URL(adminUrl!);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(root.hostname) ||
        root.pathname !== "/postgres"
      )
        throw new Error("operator_test_requires_dedicated_loopback_postgres");
      const version = Number(sql(adminUrl!, "SHOW server_version_num;").trim());
      if (version < 170000 || version >= 180000)
        throw new Error("operator_test_requires_pg17");
      if (sql(adminUrl!, "SHOW server_encoding;").trim() !== "UTF8")
        throw new Error("operator_test_requires_utf8");
      if (
        sql(
          adminUrl!,
          "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'reviewrouter_%';",
        ).trim() !== "0"
      )
        throw new Error("operator_test_requires_cold_isolated_cluster");
      sql(adminUrl!, `CREATE DATABASE "${dbName}";`);
      databaseCreated = true;
      root.pathname = "/" + dbName;
      const databaseUrl = root.toString();
      const migrations = "packages/platform/db/prisma/migrations";
      mkdirSync("tmp", { recursive: true });
      scratch = mkdtempSync("tmp/operator-gateway-pg-");
      const file = join(scratch, "migrations.sql");
      writeFileSync(
        file,
        readdirSync(migrations)
          .sort()
          .filter((n) => n !== "migration_lock.toml")
          .map((n) =>
            readFileSync(join(migrations, n, "migration.sql"), "utf8"),
          )
          .join("\n"),
      );
      execFileSync("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 120000,
      });
      // Prisma CLI normally creates this ledger before the release ACL routine.
      sql(
        databaseUrl,
        `CREATE TABLE "_prisma_migrations" (id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at TIMESTAMPTZ,migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,applied_steps_count INTEGER NOT NULL DEFAULT 0);`,
      );
      const roles = [
        { role: "web", username: "reviewrouter_web" },
        { role: "api", username: "reviewrouter_api" },
        { role: "worker", username: "reviewrouter_worker" },
        {
          role: "effect-authority",
          username: "reviewrouter_codex_effect_authority",
        },
        {
          role: "comment-token-custody",
          username: "reviewrouter_comment_token_custody",
        },
      ];
      for (const { username } of roles)
        sql(
          databaseUrl,
          `CREATE ROLE ${username} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
        );
      const grantScript = `import {runtimeGrantStatements} from './scripts/run-codex-rotating-release-migration.mjs';process.stdout.write(runtimeGrantStatements({roles:${JSON.stringify(roles)}},undefined,{skipDatabaseAcl:true}));`;
      sql(
        databaseUrl,
        execFileSync(
          "node",
          ["--import", "tsx", "--input-type=module", "-e", grantScript],
          { encoding: "utf8" },
        ),
      );
      admin = createPrismaClient({ databaseUrl });
      await admin.workspace.create({
        data: {
          id: command.workspaceId,
          slug: "operator-gateway-test",
          name: "Operator Gateway fixture",
        },
      });
      await admin.user.create({
        data: {
          id: "operator-owner",
          githubUserId: 12345n,
          githubLogin: "fixture-owner",
        },
      });
      await admin.workspaceMember.create({
        data: {
          workspaceId: command.workspaceId,
          userId: "operator-owner",
          role: "owner",
        },
      });
      await admin.gitHubInstallation.create({
        data: {
          id: "operator-installation",
          workspaceId: command.workspaceId,
          githubInstallationId: 42n,
          accountLogin: "owner",
          accountType: "Organization",
          repositorySelection: "selected",
        },
      });
      await admin.repositoryConnection.create({
        data: {
          id: command.repositoryId,
          workspaceId: command.workspaceId,
          installationId: "operator-installation",
          githubRepositoryId: 123456n,
          provider: "github",
          sourceBaseUrl: "https://github.com",
          externalRepositoryId: "123456",
          owner: "owner",
          name: "repo",
          fullName: "owner/repo",
          defaultBranch: "main",
          visibility: "private",
        },
      });
      const repositories = createPrismaReviewRunControlRepositories(admin);
      const identities = new ManageScmRepositoryIdentities({
        clock: { now: () => new Date() },
        identifiers: { nextId: (p) => `${p}-${randomUUID()}` },
        identityQueries: repositories.repositoryIdentities,
        identityCommands: repositories.repositoryIdentities,
        authorityQueries: repositories.mutationAuthorities,
      });
      const resolved = await identities.resolveOrRegisterScmRepositoryIdentity({
        provider: ScmProvider.GitHub,
        sourceBaseUrl: "https://github.com",
        externalRepositoryId: "123456",
      });
      scmId = resolved.identity.scmRepositoryIdentityId;
      await identities.bindScmRepositoryIdentity({
        scmRepositoryIdentityId: scmId,
        expectedVersion: resolved.identity.version,
        workspaceId: command.workspaceId,
        repositoryConnectionId: command.repositoryId,
      });
      await admin.providerAccountConnection.create({
        data: {
          id: "operator-connection",
          ownerWorkspaceId: command.workspaceId,
          gatewayAccountRef: "fixture-gateway-account",
          profileRef,
          displayName: "Fixture FREE",
          state: "active",
        },
      });
      await admin.workspaceAccountBinding.create({
        data: {
          id: "operator-binding",
          workspaceId: command.workspaceId,
          connectionId: "operator-connection",
          state: "active",
        },
      });
      await admin.workspaceProviderProfile.create({
        data: {
          id: "operator-profile",
          workspaceId: command.workspaceId,
          credentialKind: "gateway_binding",
          authMode: "codex_account_gateway",
          gatewayBindingId: "operator-binding",
          gatewayProfileRef: profileRef,
          model: "fixture/free-model",
          label: "Fixture FREE",
          identityKey: "fixture-profile",
        },
      });
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        providers: [
          {
            ...workspacePolicyFixture.providers[0],
            kind: "codex",
            authMode: "codex_account_gateway",
            gatewayBindingId: "operator-binding",
            gatewayProfileRef: profileRef,
            model: "fixture/free-model",
          },
        ],
      });
      const policy = workspacePolicyDocumentFixture(config, [
        "operator-profile",
      ]);
      await admin.reviewConfiguration.create({
        data: {
          id: "operator-config",
          workspaceId: command.workspaceId,
          targetKey: "workspace:default",
        },
      });
      // Match the canonical policy writer's top-level scoped version create.
      // The profile selected by policyJson owns the binding; schema 5 does not
      // use the legacy version-level gateway pointer columns.
      await admin.reviewConfigurationVersion.create({
        data: {
          configurationId: "operator-config",
          workspaceId: command.workspaceId,
          version: 1,
          schemaVersion: policy.schemaVersion,
          policyJson: JSON.stringify(policy),
        },
      });
      // Existing global safety baseline is a prerequisite; create it through the
      // normal safety commands. Repository core5 remains absent until confirm.
      const safety = new ManageReviewSafetyControls({
        clock: { now: () => new Date() },
        identifiers: { nextId: (p) => `${p}-${randomUUID()}` },
        inspections: repositories.safetyControls,
        policyCommands: repositories.safetyControls,
        emergencyCommands: repositories.safetyControls,
      });
      const globalScope = { scope: ReviewSafetyPolicyScope.Global } as const;
      for (const capability of gatewayReviewV2SafetyCapabilities) {
        const current =
          await repositories.safetyControls.findReviewSafetyPolicy({
            scope: globalScope,
            capability,
          });
        const result = await safety.updateReviewSafetyPolicy({
          expectedVersion: current?.version ?? 0,
          scope: globalScope,
          capability,
          rolloutMode: ReviewSafetyRolloutMode.Allowlisted,
          updatedBy: "fixture-bootstrap",
        });
        expect(result.status, JSON.stringify(result)).not.toBe("conflict");
        expect(result).toMatchObject({
          policy: { rolloutMode: ReviewSafetyRolloutMode.Allowlisted },
        });
      }
      // Cold migration 000029 deliberately seeds a stopped global version 1.
      // Use the normal CAS command with that actual version; never ignore a
      // rejected baseline write and misdiagnose the production safety guard.
      const currentStop =
        await repositories.safetyControls.findReviewSafetyEmergencyControl(
          globalScope,
        );
      expect(currentStop).toMatchObject({ version: 1, stopped: true });
      const opened = await safety.setReviewSafetyEmergencyStop({
        expectedVersion: currentStop!.version,
        scope: globalScope,
        stopped: false,
        reason: "isolated-test-baseline",
        updatedBy: "fixture-bootstrap",
      });
      expect(opened.status, JSON.stringify(opened)).toBe("updated");
      expect(opened).toMatchObject({ control: { stopped: false, version: 2 } });
      const runtimeUrl = new URL(databaseUrl);
      runtimeUrl.username = "reviewrouter_api";
      runtimeUrl.password = "";
      api = createPrismaClient({ databaseUrl: runtimeUrl.toString() });
      const workflow = renderAccountGatewayWorkflow({
        actionRef: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF,
        apiUrl: env.REVIEW_ROUTER_PUBLIC_API_URL,
        githubRepositoryId: "123456",
      });
      github.auth.mockImplementation(
        async (input: { permissions: Record<string, string> }) => ({
          token: "isolated-github-fixture",
          expiresAt: "2099-01-01T00:00:00Z",
          permissions: input.permissions,
        }),
      );
      github.request.mockImplementation(
        async (route: string, parameters: Record<string, unknown>) => {
          if (route === "GET /repos/{owner}/{repo}")
            return {
              data: {
                id: 123456,
                full_name: "owner/repo",
                default_branch: "main",
              },
            };
          if (route === "GET /repos/{owner}/{repo}/pulls") return { data: [] };
          if (route === "GET /repos/{owner}/{repo}/branches/{branch}")
            return { data: { name: "main", commit: { sha: head } } };
          if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}")
            return { data: { object: { sha: head } } };
          if (route === "GET /repos/{owner}/{repo}/commits/{ref}")
            return { data: { sha: "d".repeat(40) } };
          if (
            route === "GET /repos/{owner}/{repo}/contents/{path}" &&
            parameters.path === workflow.path
          )
            return {
              data: {
                type: "file",
                path: workflow.path,
                encoding: "base64",
                sha: blob,
                content: Buffer.from(workflow.content).toString("base64"),
              },
            };
          throw Object.assign(new Error("isolated-fixture-not-found"), {
            status: 404,
          });
        },
      );
    }, 180000);
    afterAll(async () => {
      await api?.$disconnect();
      await admin?.$disconnect();
      if (scratch) rmSync(scratch, { recursive: true, force: true });
      if (databaseCreated)
        sql(adminUrl!, `DROP DATABASE "${dbName}" WITH (FORCE);`);
      // The parent owns this cold container and its global migration roles.
    });
    it("creates real authority/core5/setup with ordinary API grants and restores idempotently", async () => {
      const role = await api.$queryRaw<
        { role: string; superuser: boolean; bypass: boolean; owner: boolean }[]
      >`SELECT current_user AS role,r.rolsuper AS superuser,r.rolbypassrls AS bypass,c.relowner=r.oid AS owner FROM pg_roles r,pg_class c WHERE r.rolname=current_user AND c.oid='public."WorkflowProvisioning"'::regclass`;
      expect(role).toEqual([
        {
          role: "reviewrouter_api",
          superuser: false,
          bypass: false,
          owner: false,
        },
      ]);
      expect(await admin.reviewMutationAuthority.count()).toBe(0);
      expect(
        await admin.reviewSafetyPolicy.count({
          where: { policyScope: "repository" },
        }),
      ).toBe(0);
      expect(await admin.workflowProvisioning.count()).toBe(0);
      const service = createInstalledGatewayReviewConfirmation({
        prisma: api,
        env,
        assertAuthorized: async () => {
          const member = await api.workspaceMember.findFirst({
            where: {
              workspaceId: command.workspaceId,
              userId: "operator-owner",
              role: "owner",
            },
          });
          if (!member) throw new Error("forbidden");
        },
      });
      const created = await service.confirm(command);
      expect(created.status, JSON.stringify(created)).toBe("ready");
      expect(created).toMatchObject({
        status: "ready",
        outcome: "created",
        sourceCommitSha: head,
        callerBlobSha: blob,
      });
      expect(
        await admin.reviewMutationAuthority.findFirst({
          where: { scmRepositoryIdentityId: scmId },
        }),
      ).toMatchObject({ mode: "v2_active" });
      expect(
        await admin.reviewSafetyPolicy.count({
          where: {
            policyScope: "repository",
            repositoryConnectionId: command.repositoryId,
          },
        }),
      ).toBe(5);
      expect(
        await admin.workflowProvisioning.findUnique({
          where: { repositoryId: command.repositoryId },
        }),
      ).toMatchObject({
        status: "configured",
        installedWorkflowRequirement: "gateway",
      });
      const restored = await service.confirm(command);
      expect(restored.status, JSON.stringify(restored)).toBe("ready");
      expect(restored).toMatchObject({
        status: "ready",
        outcome: "restored",
      });
      expect(await admin.reviewMutationAuthority.count()).toBe(1);
      const audits = await admin.auditEvent.findMany({
        where: { workspaceId: command.workspaceId },
        orderBy: { createdAt: "asc" },
      });
      expect(audits.map((a) => a.action)).toEqual([
        "workflow.installed_gateway_confirmation_started",
        "workflow.installed_gateway_confirmation_completed",
        "workflow.installed_gateway_confirmation_started",
        "workflow.installed_gateway_confirmation_completed",
      ]);
      expect(audits[0]).toMatchObject({
        actor: "reviewrouter-operator",
        metadata: {
          authorizedOwnerUserId: "operator-owner",
          operatorId: "reviewrouter-operator",
        },
      });
      // Legacy setupStatus is not readiness authority and receives no extra grant.
      expect(
        await admin.repositoryConnection.findUnique({
          where: { id: command.repositoryId },
        }),
      ).toMatchObject({ setupStatus: "not_configured" });
    }, 60000);
  },
);
