import {
  discoverGitLabSourceProjects,
  GitLabInstallationGateway,
  provisionGitLabReviewRouterProjects,
  type GitLabGroupProject,
} from "@reviewrouter/features-gitlab-integration";
import { getPrisma } from "./prisma";
import { PrismaGitLabInstallationInventory } from "./gitlab-installation-inventory";
import { resolveWorkflowPublicApiUrl } from "./workflow-public-api-url";

export type GitLabConnectDiscovery = Awaited<
  ReturnType<typeof discoverGitLabConnectProjects>
>;

export async function discoverGitLabConnectProjects(input: {
  readonly sourceUrl: string;
  readonly token: string;
  readonly workspaceId: string;
}): Promise<{
  readonly source: {
    readonly inputPath: string;
    readonly resolvedKind: "group" | "project";
    readonly baseUrl: string;
    readonly parentGroupPath: string | null;
  };
  readonly projects: readonly GitLabGroupProject[];
}> {
  const result = await discoverGitLabSourceProjects(
    {
      sourceUrl: input.sourceUrl,
      workspaceId: input.workspaceId,
      defaultBaseUrl: process.env.GITLAB_OAUTH_BASE_URL,
    },
    {
      installation: gitLabInstallationGateway(input.token),
    },
  );

  return {
    source: {
      ...result.source,
      parentGroupPath: result.parentGroupPath,
    },
    projects: result.projects,
  };
}

export async function installGitLabConnectProjects(input: {
  readonly sourceUrl: string;
  readonly token: string;
  readonly workspaceId: string;
  readonly selectedProjectIds: readonly string[];
  readonly installedByUserId: string;
}): Promise<{
  readonly installationId: string;
  readonly source: GitLabConnectDiscovery["source"];
  readonly namespacePath: string;
  readonly requested: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly setupMergeRequests: readonly {
    readonly projectId: string;
    readonly mergeRequestUrl: string;
  }[];
  readonly results: readonly unknown[];
}> {
  const inventory = new PrismaGitLabInstallationInventory(getPrisma());
  const requestStartedAt = await inventory.requestStartedAt();
  const discovery = await discoverGitLabConnectProjects(input);
  const selectedProjects = selectProjects({
    projects: discovery.projects,
    selectedProjectIds: input.selectedProjectIds,
  });
  const namespacePath =
    discovery.source.resolvedKind === "project"
      ? (discovery.source.parentGroupPath ?? discovery.source.inputPath)
      : discovery.source.inputPath;
  await inventory.assertProjectsNotOwned({
    workspaceId: input.workspaceId,
    sourceBaseUrl: discovery.source.baseUrl,
    projectIds: selectedProjects.map((project) => project.projectId),
  });
  const gateway = gitLabInstallationGateway(input.token);
  const apiBaseUrl = resolveWorkflowPublicApiUrl();
  const audience =
    process.env.REVIEW_ROUTER_GITLAB_OIDC_AUDIENCE ?? "reviewrouter";

  const provision = await provisionWithGroupFallback({
    gateway,
    namespacePath,
    sourceKind: discovery.source.resolvedKind,
    projectIds: selectedProjects.map((project) => project.projectId),
    apiBaseUrl,
    audience,
    reviewToken: readGitLabReviewToken(),
  });

  const { installationId } = await inventory.record({
    workspaceId: input.workspaceId,
    installedByUserId: input.installedByUserId,
    sourceBaseUrl: discovery.source.baseUrl,
    namespacePath,
    sourceKind: provision.variableTargetKind,
    requestStartedAt,
    selectedProjects,
    provision,
  });

  return {
    installationId,
    source: discovery.source,
    namespacePath,
    requested: provision.requested,
    succeeded: provision.succeeded,
    failed: provision.failed,
    setupMergeRequests: provision.results.flatMap((result) =>
      result.status === "fulfilled" &&
      result.result.mode === "setup_merge_request"
        ? [
            {
              projectId: result.projectId,
              mergeRequestUrl: result.result.mergeRequestUrl,
            },
          ]
        : [],
    ),
    results: provision.results,
  };
}

function gitLabInstallationGateway(token: string): GitLabInstallationGateway {
  return new GitLabInstallationGateway({
    token: assertToken(token),
    ...(process.env.REVIEW_ROUTER_GITLAB_API_BASE_URL
      ? { apiBaseUrl: process.env.REVIEW_ROUTER_GITLAB_API_BASE_URL }
      : {}),
  });
}

async function provisionWithGroupFallback(input: {
  readonly gateway: GitLabInstallationGateway;
  readonly namespacePath: string;
  readonly sourceKind: "group" | "project";
  readonly projectIds: readonly string[];
  readonly apiBaseUrl: string;
  readonly audience: string;
  readonly reviewToken: string;
}): Promise<
  Awaited<ReturnType<typeof provisionGitLabReviewRouterProjects>> & {
    readonly variableTargetKind: "group" | "project";
  }
> {
  const common = {
    projectIds: input.projectIds,
    controlProjectPath:
      process.env.REVIEW_ROUTER_GITLAB_CONTROL_PROJECT_PATH ??
      "777genius/review-router",
    ...(process.env.REVIEW_ROUTER_GITLAB_CONTROL_PROJECT_CONFIG_PATH
      ? {
          controlProjectConfigPath:
            process.env.REVIEW_ROUTER_GITLAB_CONTROL_PROJECT_CONFIG_PATH,
        }
      : {}),
    ...(process.env.REVIEW_ROUTER_GITLAB_CONTROL_PROJECT_REF
      ? {
          controlProjectRef:
            process.env.REVIEW_ROUTER_GITLAB_CONTROL_PROJECT_REF,
        }
      : {}),
    reviewRouterApiBaseUrl: input.apiBaseUrl,
    idTokenAudience: input.audience,
    reviewToken: input.reviewToken,
  };
  if (input.sourceKind === "group") {
    try {
      const provision = await provisionGitLabReviewRouterProjects(
        {
          ...common,
          variableTarget: { kind: "group", id: input.namespacePath },
        },
        { installation: input.gateway, clock: { now: () => new Date() } },
      );
      return { ...provision, variableTargetKind: "group" };
    } catch (error) {
      if (!isPermissionLikeGitLabError(error)) throw error;
    }
  }

  const provision = await provisionGitLabReviewRouterProjects(
    {
      ...common,
      variableTarget: { kind: "project", id: "0" },
    },
    { installation: input.gateway, clock: { now: () => new Date() } },
  );
  return { ...provision, variableTargetKind: "project" };
}

function selectProjects(input: {
  readonly projects: readonly GitLabGroupProject[];
  readonly selectedProjectIds: readonly string[];
}): readonly GitLabGroupProject[] {
  const selected = new Set(input.selectedProjectIds);
  const projects = input.projects.filter((project) =>
    selected.has(project.projectId),
  );
  if (projects.length === 0) {
    throw new Error("gitlab_connect_projects_required");
  }
  // Do not silently deselect valid existing inventory when the user supplied
  // stale or unknown project identifiers from another discovery snapshot.
  if (new Set(projects.map((project) => project.projectId)).size !== selected.size) {
    throw new Error("gitlab_connect_project_selection_stale");
  }
  return projects;
}

function assertToken(value: string): string {
  const token = value.trim();
  if (!token) throw new Error("gitlab_connect_token_required");
  return token;
}

function readGitLabReviewToken(): string {
  const token = process.env.REVIEW_ROUTER_GITLAB_API_TOKEN?.trim();
  if (!token) throw new Error("gitlab_review_token_missing");
  return token;
}

function isPermissionLikeGitLabError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "gitlab_api_error_401" ||
      error.message === "gitlab_api_error_403" ||
      error.message === "gitlab_api_error_404")
  );
}
