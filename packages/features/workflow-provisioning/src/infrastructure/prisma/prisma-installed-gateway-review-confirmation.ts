import { App } from "@octokit/app";
import { request as githubRequest } from "@octokit/request";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  requireGitHubAppPrivateKey,
  resolveReviewRouterPublicApiUrl,
} from "@reviewrouter/platform-config";
import {
  PrismaReviewPolicyHeadReader,
  resolveReviewRuntimeEnv,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  PrismaProviderAccountRepository,
  selectBinding,
} from "@reviewrouter/features-provider-accounts";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  PrismaAuditLogRepository,
  recordAuditEvent,
} from "@reviewrouter/features-audit-log";
import { areWorkflowDocumentsSemanticallyEqual } from "@reviewrouter/features-codex-oauth-rotating";
import {
  ConfirmInstalledGatewayReviewRepository,
  InstalledGatewayReviewConfirmationError,
  type InstalledGatewayReviewConfirmationCommand,
  type InstalledGatewayReviewConfirmationIssue,
} from "../../application/confirm-installed-gateway-review-repository";
import {
  requiredWorkflowTransport,
  verifiedWorkflowRequirement,
} from "../../domain/workflow-transport";
import {
  renderAccountGatewayWorkflow,
  validateAccountGatewayActionRef,
  readReviewRouterCallerSource,
} from "../../domain/workflow-template";
import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
import {
  ManagedReviewV2WorkflowInventory,
  createOctokitReviewV2RepositoryScopedReadAccess,
} from "../github/managed-review-v2-workflow-inventory";
import { PrismaWorkflowProvisioningStatusAuthority } from "./prisma-workflow-provisioning-status-authority";
import { provisionGatewayReviewV2Repository } from "./prisma-gateway-review-v2-provisioning";

/** The installed-only path deliberately does not change or deliver secrets,
 * migrate transports, merge setup PRs, or provision interaction workflows. */
export function supportsInstalledGatewayReviewConfirmation(
  config: ReviewConfiguration,
): boolean {
  return (
    requiredWorkflowTransport(config) === "gateway" &&
    (config.contextTools === undefined || config.contextTools.mcp.length === 0)
  );
}

const fail = (issue: InstalledGatewayReviewConfirmationIssue): never => {
  throw new InstalledGatewayReviewConfirmationError(issue);
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const sha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);

/** Genuine host authorization is supplied by the Dashboard/operator adapter.
 * Every setup, policy, binding and source callback is implemented here; callers
 * cannot replace these guards with readiness booleans or no-op callbacks. */
export function createInstalledGatewayReviewConfirmation(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly assertAuthorized: () => Promise<void>;
}) {
  const { prisma, env } = input;
  const audit = new PrismaAuditLogRepository(prisma);
  const accounts = new PrismaProviderAccountRepository(
    prisma,
    env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
    readPersonalAccountSharingEnabled(env),
  );

  const capture = async (command: InstalledGatewayReviewConfirmationCommand) =>
    prisma.$transaction(
      async (tx) => {
        const repository = await tx.repositoryConnection.findFirst({
          where: {
            id: command.repositoryId,
            workspaceId: command.workspaceId,
            provider: "github",
            selected: true,
            archived: false,
            installation: { status: "active" },
          },
          include: { installation: true },
        });
        if (
          !repository?.installation ||
          !repository.installationId ||
          !repository.githubRepositoryId ||
          !repository.scmRepositoryIdentityId ||
          repository.sourceBaseUrl !== "https://github.com" ||
          repository.externalRepositoryId !==
            repository.githubRepositoryId.toString()
        )
          return fail("installed_gateway_repository_unavailable");
        const identity = await tx.scmRepositoryIdentity.findUnique({
          where: {
            scmRepositoryIdentityId: repository.scmRepositoryIdentityId,
          },
        });
        if (
          !identity ||
          identity.provider !== "github" ||
          identity.currentWorkspaceId !== command.workspaceId ||
          identity.currentRepositoryConnectionId !== command.repositoryId ||
          identity.externalRepositoryId !== repository.externalRepositoryId ||
          identity.normalizedSourceBaseUrl !== repository.sourceBaseUrl
        )
          return fail("installed_gateway_scope_changed");
        const setup = await tx.workflowProvisioning.findUnique({
          where: { repositoryId: command.repositoryId },
          select: {
            workspaceId: true,
            installationId: true,
            attemptId: true,
            revision: true,
            branch: true,
            workflowPath: true,
            workflowStyle: true,
            actionVersion: true,
            status: true,
            pullRequestUrl: true,
            pullRequestHeadSha: true,
            installedWorkflowRequirement: true,
          },
        });
        if (
          setup &&
          (setup.workspaceId !== command.workspaceId ||
            setup.installationId !== repository.installationId ||
            (setup.pullRequestUrl !== null && setup.status !== "configured"))
        )
          return fail("installed_gateway_scope_changed");
        if (
          await tx.hostedCodexRepositoryBinding.findFirst({
            where: {
              workspaceId: command.workspaceId,
              repositoryConnectionId: command.repositoryId,
              status: { in: ["active", "pending_activation"] },
              tombstonedAt: null,
            },
            select: { id: true },
          })
        )
          return fail("installed_gateway_transport_unsupported");
        const runtime = await resolveReviewRuntimeEnv(
          {
            scope: "repository",
            workspaceId: command.workspaceId,
            repositoryId: command.repositoryId,
          },
          { policyHeads: new PrismaReviewPolicyHeadReader(tx) },
        );
        if (!supportsInstalledGatewayReviewConfirmation(runtime.config))
          return fail("installed_gateway_transport_unsupported");
        const bindings = [];
        for (const provider of runtime.config.providers) {
          if (
            provider.authMode !== "codex_account_gateway" ||
            !provider.gatewayBindingId
          )
            return fail("installed_gateway_binding_unavailable");
          try {
            const selected = await accounts.findBinding(
              {
                workspaceId: command.workspaceId,
                bindingId: provider.gatewayBindingId,
              },
              tx,
            );
            const tuple = selectBinding(
              command.workspaceId,
              provider.gatewayBindingId,
              selected,
              env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
            );
            if (tuple.profileRef !== provider.gatewayProfileRef)
              return fail("installed_gateway_binding_unavailable");
            bindings.push(tuple);
          } catch {
            return fail("installed_gateway_binding_unavailable");
          }
        }
        const scope = {
          repositoryId: repository.id,
          workspaceId: repository.workspaceId,
          installationId: repository.installationId,
          githubRepositoryId: repository.githubRepositoryId.toString(),
          githubInstallationId:
            repository.installation.githubInstallationId.toString(),
          fullName: repository.fullName,
          owner: repository.owner,
          name: repository.name,
          defaultBranch: repository.defaultBranch,
          scmRepositoryIdentityId: identity.scmRepositoryIdentityId,
          scmVersion: identity.version,
          policyRevision: runtime.revisionToken,
          setup,
          bindings,
        };
        return { scope, config: runtime.config, fingerprint: digest(scope) };
      },
      { isolationLevel: "RepeatableRead" },
    );

  return new ConfirmInstalledGatewayReviewRepository({
    assertAuthorized: input.assertAuthorized,
    nextAttemptId: () => `installed-gateway-${randomUUID()}`,
    audit: ({ command, attemptId, stage, facts }) =>
      recordAuditEvent(
        {
          workspaceId: command.workspaceId,
          actor: command.actor,
          action: `workflow.installed_gateway_confirmation_${stage}`,
          targetType: "repository",
          targetId: command.repositoryId,
          metadata: {
            ...facts,
            operationAttemptId: attemptId,
            ...(command.operatorAudit
              ? {
                  operatorId: command.operatorAudit.operatorId,
                  authorizedOwnerUserId: command.operatorAudit.ownerUserId,
                }
              : {}),
          },
        },
        { auditLog: audit },
      ),
    async prepare(command) {
      const captured = await capture(command);
      const { scope, config } = captured;
      const appId = env.GITHUB_APP_ID;
      if (!appId) return fail("gateway_review_v2_runtime_not_ready");
      const github = { appId, privateKey: requireGitHubAppPrivateKey(env) };
      const app = new App(github);
      const client = await app.getInstallationOctokit(
        Number(scope.githubInstallationId),
      );
      const location = { owner: scope.owner, repo: scope.name };
      const actionRef = validateAccountGatewayActionRef(
        env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ACTION_REF,
      );
      const apiUrl = resolveReviewRouterPublicApiUrl(env);
      const expected = renderAccountGatewayWorkflow({
        actionRef,
        apiUrl,
        githubRepositoryId: scope.githubRepositoryId,
      });
      const runtimeRef = readReviewRouterCallerSource(
        expected.content,
      ).runtimeRef;
      const readRuntimeCommit = async () => {
        if (sha(runtimeRef)) return runtimeRef;
        try {
          const response = await githubRequest(
            "GET /repos/{owner}/{repo}/commits/{ref}",
            {
              owner: "777genius",
              repo: "review-router",
              ref: runtimeRef,
              request: { timeout: 15_000 },
            },
          );
          if (!sha(response.data.sha))
            return fail("installed_gateway_workflow_incompatible");
          return response.data.sha;
        } catch (error) {
          if (error instanceof InstalledGatewayReviewConfirmationError)
            throw error;
          return fail("installed_gateway_upstream_unavailable");
        }
      };
      const readSource = async () => {
        try {
          const [repository, ref] = await Promise.all([
            client.request("GET /repos/{owner}/{repo}", location),
            client.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
              ...location,
              ref: `heads/${scope.defaultBranch}`,
            }),
          ]);
          const repo = repository.data;
          const commit = ref.data.object.sha;
          if (
            String(repo.id) !== scope.githubRepositoryId ||
            repo.full_name.toLowerCase() !== scope.fullName.toLowerCase() ||
            repo.default_branch !== scope.defaultBranch ||
            !sha(commit)
          )
            return fail("installed_gateway_scope_changed");
          const response = await client.request(
            "GET /repos/{owner}/{repo}/contents/{path}",
            {
              ...location,
              path: expected.path,
              ref: commit,
            },
          );
          const blob: unknown = response.data;
          if (
            !object(blob) ||
            blob.type !== "file" ||
            blob.path !== expected.path ||
            blob.encoding !== "base64" ||
            !sha(blob.sha) ||
            typeof blob.content !== "string" ||
            blob.content.length > 240_000
          )
            return fail("installed_gateway_workflow_incompatible");
          const source = Buffer.from(blob.content, "base64").toString("utf8");
          if (!areWorkflowDocumentsSemanticallyEqual(source, expected.content))
            return fail("installed_gateway_workflow_incompatible");
          return { commit, blob: blob.sha };
        } catch (error) {
          if (error instanceof InstalledGatewayReviewConfirmationError)
            throw error;
          return fail("installed_gateway_upstream_unavailable");
        }
      };
      const source = await readSource();
      const inventory = await new ManagedReviewV2WorkflowInventory({
        expectedApiUrl: apiUrl,
        access: createOctokitReviewV2RepositoryScopedReadAccess(github),
      }).inspectReviewV2ManagedWorkflowInventory({
        githubInstallationId: scope.githubInstallationId,
        githubRepositoryId: scope.githubRepositoryId,
        repositoryFullName: scope.fullName,
        owner: scope.owner,
      });
      if (
        !inventory.compatible ||
        inventory.runtimeRef !== runtimeRef ||
        inventory.defaultBranchHeadSha !== source.commit ||
        inventory.workflowSchemaVersion !== reviewRouterWorkflowContract.major
      )
        return fail("installed_gateway_workflow_incompatible");
      // The caller channel and the server-selected producer are independent.
      // Current workflow-v1 callers intentionally have no action SHA in their
      // inventory: server admission selects this immutable attested producer.
      const actionCommitSha = actionRef.split("@")[1]!;
      const runtimeCommitSha = await readRuntimeCommit();
      if (
        inventory.actionCommitSha !== null &&
        inventory.actionCommitSha !== runtimeCommitSha
      )
        return fail("installed_gateway_scope_changed");
      const assertCurrent = async () => {
        await input.assertAuthorized();
        const current = await capture(command);
        if (current.fingerprint !== captured.fingerprint)
          return fail("installed_gateway_scope_changed");
        const observed = await readSource();
        if (observed.commit !== source.commit || observed.blob !== source.blob)
          return fail("installed_gateway_scope_changed");
        if ((await readRuntimeCommit()) !== runtimeCommitSha)
          return fail("installed_gateway_scope_changed");
        // Network inspection can outlive ownership, policy and SCM changes.
        // End every pre-write callback with fresh local scope and authorization.
        if ((await capture(command)).fingerprint !== captured.fingerprint)
          return fail("installed_gateway_scope_changed");
        await input.assertAuthorized();
      };
      return {
        repository: scope.fullName,
        sourceCommitSha: source.commit,
        callerBlobSha: source.blob,
        actionCommitSha,
        workflowPath: expected.path,
        auditFacts: {
          scopeDigest: captured.fingerprint,
          scmRepositoryIdentityId: scope.scmRepositoryIdentityId,
          scmBindingVersion: scope.scmVersion,
          policyRevision: scope.policyRevision,
          setupAttemptId: scope.setup?.attemptId ?? null,
          setupRevision: scope.setup?.revision ?? null,
          bindings: scope.bindings,
          sourceCommitSha: source.commit,
          callerBlobSha: source.blob,
          runtimeCommitSha,
          actionCommitSha,
          workflowPath: expected.path,
        },
        assertCurrent,
        provision: () =>
          provisionGatewayReviewV2Repository({
            prisma,
            env,
            command: {
              workspaceId: command.workspaceId,
              repositoryId: command.repositoryId,
              actor: command.actor,
              installationId: scope.installationId,
              expectedAttempt: scope.setup
                ? {
                    attemptId: scope.setup.attemptId,
                    revision: scope.setup.revision,
                  }
                : null,
              repository: {
                githubRepositoryId: scope.githubRepositoryId,
                githubInstallationId: scope.githubInstallationId,
                fullName: scope.fullName,
                owner: scope.owner,
              },
              expectedGatewaySource: {
                actionCommitSha,
                actionRef,
                apiUrl,
                sourceRevision: source.commit,
              },
            },
            assertCurrentSetupAndSource: assertCurrent,
          }),
        async confirmConfigured() {
          await assertCurrent();
          await new PrismaWorkflowProvisioningStatusAuthority(
            prisma,
          ).confirmInstalledWorkflow({
            workspaceId: command.workspaceId,
            repositoryId: command.repositoryId,
            installationId: scope.installationId,
            expectedAttempt: scope.setup
              ? {
                  attemptId: scope.setup.attemptId,
                  revision: scope.setup.revision,
                }
              : null,
            branch: scope.setup?.branch ?? "reviewrouter/setup",
            baseBranch: scope.defaultBranch,
            status: "configured",
            workflowPath: expected.path,
            workflowStyle: "reusable",
            actionVersion: reviewRouterWorkflowContract.channel,
            workflowRequirement: verifiedWorkflowRequirement({
              managedTransport: "gateway",
              codexWorkflow: null,
              config,
            }),
          });
          const setup = await prisma.workflowProvisioning.findUnique({
            where: { repositoryId: command.repositoryId },
          });
          if (
            !setup ||
            setup.workspaceId !== command.workspaceId ||
            setup.installationId !== scope.installationId ||
            setup.status !== "configured"
          )
            return fail("installed_gateway_scope_changed");
          return { attemptId: setup.attemptId, revision: setup.revision };
        },
      };
    },
  });
}
