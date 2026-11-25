// GitHub App secret and repository access checks shared by dashboard mutations.
// This is a server-only helper, not a Next.js Server Actions entrypoint.
import type { ProviderSecretScope } from "@reviewrouter/features-provider-setup";
import type { createGitHubAppInstallationOctokit } from "../../src/server/dashboard-mutations";
import type { loadDashboardRepository } from "../../src/server/dashboard-repository-guards";
import { providerSecretAvailabilityStatusForError } from "./dashboard-action-form-readers";

export async function verifyProviderSecrets(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
  readonly secretNames: readonly string[];
  readonly secretScope: ProviderSecretScope;
}): Promise<void> {
  for (const secretName of input.secretNames) {
    if (input.secretScope === "repository") {
      await verifyRepositorySecret({
        octokit: input.octokit,
        repository: input.repository,
        secretName,
      });
    } else {
      await verifyOrganizationSecret({
        octokit: input.octokit,
        repository: input.repository,
        secretName,
      });
    }
  }
}

export async function checkProviderSecretAvailability(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
  readonly secretNames: readonly string[];
  readonly allowOrganizationSecrets?: boolean;
}): Promise<{
  readonly status:
    | "available_repository"
    | "available_organization"
    | "not_available_to_repository"
    | "missing"
    | "permission_required"
    | "unknown";
}> {
  for (const secretName of input.secretNames) {
    try {
      await verifyRepositorySecret({
        octokit: input.octokit,
        repository: input.repository,
        secretName,
      });
      continue;
    } catch (error) {
      const status = providerSecretAvailabilityStatusForError(error);
      if (status === "permission_required") return { status };
      if (status !== "missing") return { status: "unknown" };
    }

    if (input.allowOrganizationSecrets === false) {
      return { status: "missing" };
    }

    return await checkOrganizationProviderSecretAvailability({
      ...input,
      secretName,
    });
  }

  return { status: "available_repository" };
}

async function checkOrganizationProviderSecretAvailability(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
  readonly secretName: string;
}): Promise<{
  readonly status:
    | "available_organization"
    | "not_available_to_repository"
    | "missing"
    | "permission_required"
    | "unknown";
}> {
  try {
    await verifyOrganizationSecret({
      octokit: input.octokit,
      repository: input.repository,
      secretName: input.secretName,
    });
    return { status: "available_organization" };
  } catch (error) {
    const status = providerSecretAvailabilityStatusForError(error);
    if (status) return { status };

    return { status: "unknown" };
  }
}

export async function assertRepositoryVisibleToGitHubApp(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
}): Promise<void> {
  try {
    await input.octokit.request("GET /repos/{owner}/{repo}", {
      owner: input.repository.owner,
      repo: input.repository.name,
    });
  } catch (error) {
    const status = githubApiStatus(error);
    if (status === 401 || status === 403 || status === 404) {
      throw new Error("repository_not_visible_to_github_app", {
        cause: error,
      });
    }

    throw error;
  }
}

export async function assertOrgRulesetOrganizationPlanAllowed(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly organizationLogin: string;
}): Promise<void> {
  try {
    const response = await input.octokit.request("GET /orgs/{org}", {
      org: input.organizationLogin,
    });
    const planName = readGitHubOrganizationPlanName(
      (response.data as { readonly plan?: unknown }).plan,
    );
    if (planName === "free") {
      throw new Error("org_rulesets_not_supported");
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "org_rulesets_not_supported"
    ) {
      throw error;
    }
    const status = githubApiStatus(error);
    if (status === 401 || status === 403) return;
    throw error;
  }
}

async function verifyRepositorySecret(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
  readonly secretName: string;
}): Promise<void> {
  await requestProviderSecretMetadata(async () => {
    await input.octokit.request(
      "GET /repos/{owner}/{repo}/actions/secrets/{secret_name}",
      {
        owner: input.repository.owner,
        repo: input.repository.name,
        secret_name: input.secretName,
      },
    );
  });
}

async function verifyOrganizationSecret(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly repository: Awaited<ReturnType<typeof loadDashboardRepository>>;
  readonly secretName: string;
}): Promise<void> {
  const secret = await requestProviderSecretMetadata(async () => {
    const response = await input.octokit.request(
      "GET /orgs/{org}/actions/secrets/{secret_name}",
      {
        org: input.repository.owner,
        secret_name: input.secretName,
      },
    );
    return response.data as { readonly visibility?: string };
  });
  const visibility = secret.visibility;

  if (visibility === "all") return;
  if (visibility === "private" && input.repository.visibility === "private") {
    return;
  }
  if (visibility !== "selected") {
    throw new Error("provider_secret_not_available_to_repository");
  }

  const selected = await organizationSecretIncludesRepository({
    octokit: input.octokit,
    org: input.repository.owner,
    secretName: input.secretName,
    githubRepositoryId: input.repository.githubRepositoryId,
  });
  if (!selected) {
    throw new Error("provider_secret_not_available_to_repository");
  }
}

async function organizationSecretIncludesRepository(input: {
  readonly octokit: Awaited<
    ReturnType<typeof createGitHubAppInstallationOctokit>
  >;
  readonly org: string;
  readonly secretName: string;
  readonly githubRepositoryId: bigint;
}): Promise<boolean> {
  const expectedId = input.githubRepositoryId.toString();

  for (let page = 1; page <= 100; page += 1) {
    const response = await requestProviderSecretMetadata(async () => {
      return input.octokit.request(
        "GET /orgs/{org}/actions/secrets/{secret_name}/repositories",
        {
          org: input.org,
          secret_name: input.secretName,
          per_page: 100,
          page,
        },
      );
    });
    const repositories = toRepositoryIdRecords(response.data);

    if (repositories.some((repository) => repository.id === expectedId)) {
      return true;
    }
    if (repositories.length < 100) return false;
  }

  return false;
}

async function requestProviderSecretMetadata<T>(
  request: () => Promise<T>,
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const status = githubApiStatus(error);
    if (status === 401 || status === 403) {
      throw new Error("provider_secret_check_permission_required", {
        cause: error,
      });
    }
    if (status === 404) {
      throw new Error("provider_secret_not_found", { cause: error });
    }

    throw error;
  }
}

export function githubApiStatus(error: unknown): number | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return null;
}

function readGitHubOrganizationPlanName(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim().length > 0
  ) {
    return value.name.trim().toLowerCase();
  }

  return null;
}

function toRepositoryIdRecords(
  value: unknown,
): readonly { readonly id: string }[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("repositories" in value) ||
    !Array.isArray(value.repositories)
  ) {
    return [];
  }

  return value.repositories
    .map((repository) => {
      if (
        typeof repository === "object" &&
        repository !== null &&
        "id" in repository
      ) {
        return { id: String(repository.id) };
      }

      return null;
    })
    .filter((repository): repository is { readonly id: string } =>
      Boolean(repository),
    );
}
