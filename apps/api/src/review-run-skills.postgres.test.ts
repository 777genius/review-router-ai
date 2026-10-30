import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaReviewSkillsService } from "@reviewrouter/features-review-skills/composition";
import type { ReviewSkillsService } from "@reviewrouter/features-review-skills";
import {
  ReviewTrustDomain,
  type ReviewAgentProfile,
} from "@reviewrouter/features-review-run-control";
import {
  createReviewActionV2E2EHarness,
  resetReviewActionV2E2EDatabase,
} from "../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import { registerReviewRunSkillsRoute } from "./review-run-skills";
import { ProductionReviewSkillsSnapshot } from "./review-run-skills-snapshot";
import {
  canonicalReviewSkillsJson,
  parseCapturedReviewSkills,
} from "@reviewrouter/shared/review-skills-contract";
import {
  PrismaReviewConfigurationRepository,
  parseReviewConfigurationStrict,
} from "@reviewrouter/features-review-config";
import {
  systemPolicyWriteFixture,
  workspacePolicyFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { renderReviewRouterProviderApiCaller } from "@reviewrouter/protocol-review-workflow";

const databaseUrl = process.env.REVIEW_SKILLS_ADMISSION_TEST_DATABASE_URL;
const actionSourceDir = process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR;
const loopbackFetch = globalThis.fetch;
if (
  process.env.REVIEW_SKILLS_REQUIRE_PAIRED === "1" &&
  (!databaseUrl || !actionSourceDir)
)
  throw new Error("review_skills_paired_database_and_action_source_required");
if (!databaseUrl && process.env.REVIEW_SKILLS_REQUIRE_ADMISSION_PG === "1")
  throw new Error("review_skills_admission_postgresql_required");
const legacy: ReviewAgentProfile = {
  profileRef: "codex-default",
  agentKind: "codex",
  packageVersion: "0.147.0",
  binarySha256: "c".repeat(64),
  modelTransports: ["account_gateway", "provider_api"],
  contextGateway: true,
  cancellation: true,
};
const supporting: ReviewAgentProfile = {
  ...legacy,
  profileRef: "codex-skills-fixture",
  reviewSkillsVersion: 1,
};

describe.skipIf(!databaseUrl)(
  "Skills with real PostgreSQL, signed admission and captured companion",
  () => {
    let harness: Awaited<ReturnType<typeof createReviewActionV2E2EHarness>>;
    const configurations = () =>
      new PrismaReviewConfigurationRepository(
        harness.prisma,
        undefined,
        false,
        undefined,
      );
    let service: ReviewSkillsService;
    let actor: { userId: string };
    let sourceWorkspaceId: string;
    beforeEach(async () => {
      await resetReviewActionV2E2EDatabase(databaseUrl!);
      // The workspace OpenRouter default below must not be shadowed by the
      // harness's repository selection.
      harness = await createReviewActionV2E2EHarness(databaseUrl!, {
        agentProfiles: [legacy, supporting],
        repositoryProviderSelection: "none",
      });
      // Stock test migrations retain the test login as table owner. Production
      // transfers ownership to this NOLOGIN role; give its helper the same narrow
      // read/row-lock authority in this disposable fixture without changing owners.
      await harness.prisma.$executeRawUnsafe(
        'GRANT SELECT, UPDATE("id") ON TABLE public."RepositoryConnection" TO reviewrouter_release_schema_owner',
      );
      // OpenRouter is delivered only by the workspace's managed API key.
      await harness.prisma.providerApiKeyConnection.create({
        data: {
          workspaceId: harness.workspaceId,
          providerType: "openrouter",
          encryptedApiKey: "skills-e2e-ciphertext",
          keyVersion: 1,
          latestOperationId: `${harness.workspaceId}-openrouter-key`,
        },
      });
      const workspaceTarget = {
        scope: "workspace" as const,
        workspaceId: harness.workspaceId,
      };
      await configurations().saveNextVersion({
        target: workspaceTarget,
        expectedVersion: 1,
        ...systemPolicyWriteFixture(
          parseReviewConfigurationStrict({
            ...workspacePolicyFixture,
            providers: [
              {
                kind: "openrouter",
                authMode: "openrouter_api_key",
                model: "openai/gpt-5.3-codex",
                reasoningEffort: "high",
                agenticContext: true,
                fastMode: false,
                requiredHealthy: true,
              },
            ],
          }),
          workspaceTarget,
        ),
      });
      const caller = renderReviewRouterProviderApiCaller({
        runtimeRef: "a".repeat(40),
        controlPlaneUrl: harness.env.REVIEW_ROUTER_PUBLIC_API_URL!,
      });
      const previousFetch = harness.fakeGitHub.fetch;
      vi.spyOn(harness.fakeGitHub, "fetch").mockImplementation(
        async (input, init) => {
          const request =
            input instanceof Request ? input : new Request(String(input), init);
          const url = new URL(request.url);
          if (
            url.hostname === "api.github.com" &&
            decodeURIComponent(url.pathname).endsWith(
              "/contents/.github/workflows/reviewrouter-review.yml",
            )
          )
            return Response.json({
              type: "file",
              path: ".github/workflows/reviewrouter-review.yml",
              encoding: "base64",
              content: Buffer.from(caller).toString("base64"),
            });
          return previousFetch(input, init);
        },
      );
      actor = { userId: `${harness.prefix}-author` };
      sourceWorkspaceId = `${harness.prefix}-source`;
      await harness.prisma.user.create({
        data: { id: actor.userId, githubLogin: "skills-fixture-author" },
      });
      await harness.prisma.workspace.create({
        data: {
          id: sourceWorkspaceId,
          slug: sourceWorkspaceId,
          name: "Skills source",
        },
      });
      for (const workspaceId of [sourceWorkspaceId, harness.workspaceId])
        await harness.prisma.workspaceMember.create({
          data: { workspaceId, userId: actor.userId, role: "owner" },
        });
      service = await createPrismaReviewSkillsService({
        prisma: harness.prisma,
        repositoryAccess: { authorizeRepositoryManagement: async () => [] },
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      await harness?.close();
    });
    const admit = (sourceRunAttempt = "1") =>
      harness.authorize({
        sourceRunAttempt,
        providerApiAuthMode: "openrouter-api",
      });
    const content = (revision: string) => ({
      name: "Security",
      description: "Review validation",
      instructions: `REVIEW_SKILLS_PRIVATE_${revision}: reject unchecked user input.`,
    });
    async function assigned() {
      const skill = await service.createSkill({
        createOperationId: randomUUID(),
        actor,
        workspaceId: sourceWorkspaceId,
        content: content("ONE"),
      });
      const link = await service.linkSkillAsDualAdmin({
        actor,
        sourceWorkspaceId,
        destinationWorkspaceId: harness.workspaceId,
        skillId: skill.skillId,
      });
      await service.applyAssignments({
        actor,
        workspaceId: harness.workspaceId,
        repositoryIds: [harness.repositoryConnectionId],
        skillIds: [skill.skillId],
        mode: "add",
        scope: { includePaths: ["src/**"], excludePaths: ["src/generated/**"] },
      });
      return { skill, link };
    }

    it("captures web revisions, keeps accepted runs after revoke and never exposes a new source head", async () => {
      const { skill, link } = await assigned();
      const first = await admit();
      const row = await harness.prisma.reviewRunAuthorization.findUniqueOrThrow(
        { where: { authorizationId: first.authorizationId } },
      );
      const capture = JSON.parse(row.skillsSnapshotCanonicalJson!);
      expect(capture.webSkills).toMatchObject([
        {
          skillId: skill.skillId,
          revisionId: skill.revisionId,
          instructions: content("ONE").instructions,
          includePaths: ["src/**"],
          excludePaths: ["src/generated/**"],
        },
      ]);
      expect(capture.baseSha).toBe(row.baseSha);
      // Token facts remain the existing published language; the body is private.
      expect(JSON.stringify(first.result)).not.toContain(
        "REVIEW_SKILLS_PRIVATE",
      );
      const updated = await service.saveSkill({
        actor,
        workspaceId: sourceWorkspaceId,
        skillId: skill.skillId,
        expectedRevisionId: skill.revisionId,
        content: content("TWO"),
      });
      expect((await admit()).authorizationId).toBe(first.authorizationId);
      const next = await admit("2");
      const nextRow =
        await harness.prisma.reviewRunAuthorization.findUniqueOrThrow({
          where: { authorizationId: next.authorizationId },
        });
      expect(
        JSON.parse(nextRow.skillsSnapshotCanonicalJson!).webSkills[0]
          .revisionId,
      ).toBe(updated.revisionId);
      expect(JSON.parse(nextRow.skillsSnapshotCanonicalJson!).digest).not.toBe(
        capture.digest,
      );
      await service.revokeSkillGrant({
        actor,
        sourceWorkspaceId,
        destinationWorkspaceId: harness.workspaceId,
        skillId: skill.skillId,
        expectedGrantVersion: link.acceptedGrantVersion,
      });
      await service.saveSkill({
        actor,
        workspaceId: sourceWorkspaceId,
        skillId: skill.skillId,
        expectedRevisionId: updated.revisionId,
        content: content("AFTER_REVOKE"),
      });
      await expect(admit("3")).rejects.toMatchObject({
        statusCode: 422,
        issues: ["review_run_authorize:skills_unavailable"],
      });
      expect((await admit()).authorizationId).toBe(first.authorizationId);
      const renewal = await harness.createRenewRequest(first);
      expect(harness.routes.runControl.renew).toBeDefined();
      await harness.routes.runControl.renew!.execute(renewal);
      const retained =
        await harness.prisma.reviewRunAuthorization.findUniqueOrThrow({
          where: { authorizationId: first.authorizationId },
        });
      expect(retained.skillsSnapshotCanonicalJson).toBe(
        row.skillsSnapshotCanonicalJson,
      );
      await expect(
        harness.prisma.reviewRunAuthorization.update({
          where: { authorizationId: row.authorizationId },
          data: {
            skillsSnapshotCanonicalJson: nextRow.skillsSnapshotCanonicalJson,
          },
        }),
      ).rejects.toThrow(/immutable/);

      const app = Fastify();
      await registerReviewRunSkillsRoute(app, harness.routes.reviewSkills!);
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/action/v2/skills",
          headers: { authorization: `Bearer ${first.authorizationToken}` },
          payload: {},
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual(capture);
        expect(response.body).not.toContain("AFTER_REVOKE");
      } finally {
        await app.close();
      }
    });

    it("refuses content drift between capture and atomic admission, then admits the new revision", async () => {
      const { skill } = await assigned();
      const realCapture = ProductionReviewSkillsSnapshot.prototype.capture;
      vi.spyOn(
        ProductionReviewSkillsSnapshot.prototype,
        "capture",
      ).mockImplementationOnce(async function (
        this: ProductionReviewSkillsSnapshot,
        input,
      ) {
        const captured = await realCapture.call(this, input);
        await service.saveSkill({
          actor,
          workspaceId: sourceWorkspaceId,
          skillId: skill.skillId,
          expectedRevisionId: skill.revisionId,
          content: content("RACED"),
        });
        return captured;
      });
      await expect(admit()).rejects.toMatchObject({
        statusCode: 412,
        issues: ["admission_facts_changed"],
      });
      expect(await harness.prisma.reviewRunAuthorization.count()).toBe(0);
      const admitted = await admit("2");
      const row = await harness.prisma.reviewRunAuthorization.findUniqueOrThrow(
        { where: { authorizationId: admitted.authorizationId } },
      );
      expect(
        JSON.parse(row.skillsSnapshotCanonicalJson!).webSkills[0].instructions,
      ).toBe(content("RACED").instructions);
    });

    it("captures explicit Git roots even with an empty web library and blocks unsupported producers", async () => {
      await service.setRepositorySources({
        actor,
        workspaceId: harness.workspaceId,
        repositoryId: harness.repositoryConnectionId,
        expectedVersion: 0,
        roots: [".reviewrouter/skills"],
      });
      const admitted = await admit();
      const row = await harness.prisma.reviewRunAuthorization.findUniqueOrThrow(
        { where: { authorizationId: admitted.authorizationId } },
      );
      expect(JSON.parse(row.skillsSnapshotCanonicalJson!)).toMatchObject({
        webSkills: [],
        gitSources: [{ root: ".reviewrouter/skills" }],
        baseSha: row.baseSha,
      });
      const production = new ProductionReviewSkillsSnapshot(harness.prisma);
      const identity = {
        ...row,
        trustDomain: ReviewTrustDomain.TrustedManaged,
      };
      expect(await production.capture({ identity, agent: legacy })).toEqual({
        captureDenied: "skills_engine_unsupported",
      });
      expect(
        await production.capture({
          identity,
          agent: null,
          agents: [legacy, supporting],
        }),
      ).toEqual({ captureDenied: "skills_engine_unsupported" });

      await service.setRepositorySources({
        actor,
        workspaceId: harness.workspaceId,
        repositoryId: harness.repositoryConnectionId,
        expectedVersion: 1,
        roots: [],
      });
      const empty = await production.capture({
        identity,
        agent: null,
        agents: [legacy, supporting],
      });
      if (!("canonicalJson" in empty) || empty.canonicalJson === null)
        throw new Error("mixed_empty_skills_capture_required");
      const capture = parseCapturedReviewSkills(
        JSON.parse(empty.canonicalJson),
      );
      expect(capture).toMatchObject({
        baseSha: row.baseSha,
        webSkills: [],
        gitSources: [],
      });
      expect(canonicalReviewSkillsJson(capture)).toBe(empty.canonicalJson);
      expect(
        await production.capture({ identity, agent: null, agents: [legacy] }),
      ).toEqual({
        canonicalJson: null,
      });
    });
    it.skipIf(!actionSourceDir)(
      "delivers a signed captured snapshot over HTTP into the paired runtime's scope and cache identity",
      async () => {
        const { skill } = await assigned();
        const first = await admit();
        const row =
          await harness.prisma.reviewRunAuthorization.findUniqueOrThrow({
            where: { authorizationId: first.authorizationId },
          });
        const load = (relative: string) =>
          import(pathToFileURL(join(actionSourceDir!, relative)).href);
        const [transport, execution] = await Promise.all([
          load("src/review-skills/review-skills-transport.ts"),
          load("src/review-skills/review-skills.ts"),
        ]);
        const app = Fastify();
        await registerReviewRunSkillsRoute(app, harness.routes.reviewSkills!);
        const apiUrl = await app.listen({ host: "127.0.0.1", port: 0 });
        const read = (authorizationToken: string) =>
          transport.fetchCapturedReviewSkills({
            apiUrl,
            authorizationToken,
            baseSha: row.baseSha,
            fetchImpl: loopbackFetch,
          });
        try {
          const capture = await read(first.authorizationToken);
          expect(capture).toEqual(JSON.parse(row.skillsSnapshotCanonicalJson!));
          const bundle = execution.createMaterializedReviewSkills(capture, []);
          const projected = execution.projectReviewSkillsForPaths(bundle, [
            "src/api.ts",
            "src/generated/client.ts",
            "docs/api.md",
          ]);
          const byPath = new Map(
            projected.map((item: { path: string; instructions: string }) => [
              item.path,
              item.instructions,
            ]),
          );
          expect(byPath.get("src/api.ts")).toContain(
            content("ONE").instructions,
          );
          expect(byPath.get("src/generated/client.ts")).toBe("");
          expect(byPath.get("docs/api.md")).toBe("");
          const originalIdentity = execution.reviewSkillsCacheIdentity(bundle);
          await service.saveSkill({
            actor,
            workspaceId: sourceWorkspaceId,
            skillId: skill.skillId,
            expectedRevisionId: skill.revisionId,
            content: content("PAIRED_NEW"),
          });
          expect(await read(first.authorizationToken)).toEqual(capture);
          const next = await admit("2");
          const nextBundle = execution.createMaterializedReviewSkills(
            await read(next.authorizationToken),
            [],
          );
          expect(execution.reviewSkillsCacheIdentity(nextBundle)).not.toEqual(
            originalIdentity,
          );
          expect(
            execution.renderReviewSkillsForPaths(nextBundle, ["src/api.ts"]),
          ).toContain(content("PAIRED_NEW").instructions);
          await expect(read("forged-token")).rejects.toThrow(
            "review_skills_transport_unavailable",
          );
        } finally {
          await app.close();
        }
      },
    );

    it("keeps older Secrets transports legacy and refuses assigned Skills before inference", async () => {
      // The rotating Codex fixture is a repository selection (rotating is
      // never a workspace default); it shadows the OpenRouter default.
      const repositoryTarget = {
        scope: "repository" as const,
        workspaceId: harness.workspaceId,
        repositoryId: harness.repositoryConnectionId,
      };
      await configurations().saveNextVersion({
        target: repositoryTarget,
        expectedVersion: null,
        ...systemPolicyWriteFixture(workspacePolicyFixture, repositoryTarget),
      });
      const first = await harness.authorize();
      const row = await harness.prisma.reviewRunAuthorization.findUniqueOrThrow(
        { where: { authorizationId: first.authorizationId } },
      );
      expect(JSON.parse(row.runtimeSnapshotCanonicalJson!).agent).toEqual(
        legacy,
      );
      expect(row.skillsSnapshotCanonicalJson).toBeNull();
      await assigned();
      await expect(
        harness.authorize({ sourceRunAttempt: "2" }),
      ).rejects.toMatchObject({
        statusCode: 422,
        issues: ["review_run_authorize:skills_engine_unsupported"],
      });
      expect((await harness.authorize()).authorizationId).toBe(
        first.authorizationId,
      );
    });
  },
);
