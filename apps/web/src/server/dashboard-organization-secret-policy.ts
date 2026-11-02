import { createGitHubAppInstallationOctokit } from "./dashboard-mutations";

export type DashboardOrganizationSecretPolicy = Readonly<{
  planName: string | null;
  privateRepositoriesAvailable: boolean | null;
  status: "available" | "permission_required" | "unknown";
}>;

export type OrganizationSecretPolicyInput = Readonly<{
  accountLogin: string;
  accountType: string;
  githubInstallationId: bigint;
}>;

export type OrganizationPlanReader = (
  input: Pick<OrganizationSecretPolicyInput, "accountLogin" | "githubInstallationId">,
) => Promise<unknown>;

type CacheEntry =
  | Readonly<{ pending: Promise<DashboardOrganizationSecretPolicy> }>
  | Readonly<{
      policy: DashboardOrganizationSecretPolicy;
      expiresAt: number;
    }>;

const maxCacheEntries = 128;
const availableTtlMs = 5 * 60_000;
const permissionRequiredTtlMs = 30_000;
const unknownTtlMs = 5_000;

/**
 * Per-process, bounded and single-flight organization metadata read.
 *
 * The reader is an explicit port: the cache never knows about GitHub SDKs,
 * sessions, or UI components. GitHub failures stay metadata-only and never
 * grant repository access. An evicted pending lookup cannot refill the cache.
 */
export function createOrganizationSecretPolicyLoader(input: {
  readonly readPlan: OrganizationPlanReader;
  readonly now?: () => number;
  readonly capacity?: number;
}): (organization: OrganizationSecretPolicyInput) => Promise<DashboardOrganizationSecretPolicy | null> {
  const now = input.now ?? Date.now;
  const capacity = input.capacity ?? maxCacheEntries;
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("organization_secret_policy_cache_capacity_invalid");
  }
  const cache = new Map<string, CacheEntry>();

  return async (organization) => {
    if (organization.accountType !== "Organization") return null;

    const key =
      String(organization.githubInstallationId) +
      ":" +
      organization.accountLogin.toLowerCase();
    const cached = cache.get(key);
    if (cached) {
      if ("pending" in cached) return cached.pending;
      if (cached.expiresAt > now()) {
        cache.delete(key);
        cache.set(key, cached);
        return cached.policy;
      }
      cache.delete(key);
    }

    const pending = Promise.resolve()
      .then(() => input.readPlan(organization))
      .then((plan): DashboardOrganizationSecretPolicy => {
        const planName = readGitHubOrganizationPlanName(plan);
        return {
          planName,
          privateRepositoriesAvailable: planName ? planName !== "free" : null,
          status: planName ? "available" : "unknown",
        };
      })
      .catch((error): DashboardOrganizationSecretPolicy => ({
        planName: null,
        privateRepositoriesAvailable: null,
        status:
          githubApiStatus(error) === 401 || githubApiStatus(error) === 403
            ? "permission_required"
            : "unknown",
      }))
      .then((policy) => {
        if (cache.get(key) === entry) {
          const ttl =
            policy.status === "available"
              ? availableTtlMs
              : policy.status === "permission_required"
                ? permissionRequiredTtlMs
                : unknownTtlMs;
          cache.set(key, { policy, expiresAt: now() + ttl });
        }
        return policy;
      });
    const entry: CacheEntry = { pending };
    cache.set(key, entry);
    if (cache.size > capacity) cache.delete(cache.keys().next().value!);
    return pending;
  };
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

function githubApiStatus(error: unknown): number | null {
  return typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : null;
}

export const loadOrganizationSecretPolicy = createOrganizationSecretPolicyLoader({
  readPlan: async ({ accountLogin, githubInstallationId }) => {
    const octokit = await createGitHubAppInstallationOctokit(
      githubInstallationId.toString(),
    );
    const response = await octokit.request("GET /orgs/{org}", {
      org: accountLogin,
    });
    return (response.data as { readonly plan?: unknown }).plan;
  },
});
