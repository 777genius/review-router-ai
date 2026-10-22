import {
  buildMemoryBundle,
  defaultMemoryBundlePolicy,
  type ActionMemoryBundle,
  type MemoryBundlePolicy,
} from "../../domain/memory-bundle-policy";
import type { MemoryItemSnapshot } from "../../domain/memory-item";
import type { ListActiveMemoryForBundleInput } from "../ports/memory-item-repository-port";
import type {
  MemorySearchCapability,
  MemorySearchReaderPort,
  MemorySearchRequestControls,
} from "../ports/memory-search-index-port";
import type { MemoryUseCaseDependencies } from "./memory-use-case-types";

export type BuildActionMemoryBundleInput = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly userId: string | null;
  readonly safeRetrievalQuery?: string | null;
  readonly policy?: Partial<MemoryBundlePolicy>;
};

type BundleDependencies = Pick<
  MemoryUseCaseDependencies,
  "memoryItems" | "memoryPolicyConfig"
> &
  Partial<Pick<MemoryUseCaseDependencies, "clock">> & {
    readonly memorySearchIndex?: MemorySearchReaderPort;
  };

// This budget covers capability discovery and retrieval together. Canonical
// fallback remains available even if an adapter ignores its cancellation signal.
const retrievalBudgetMs = 2_000;

export async function buildActionMemoryBundle(
  input: BuildActionMemoryBundleInput,
  dependencies: BundleDependencies,
): Promise<ActionMemoryBundle> {
  const policyConfig = await dependencies.memoryPolicyConfig.getPolicy({
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
  });
  const policy = {
    ...defaultMemoryBundlePolicy,
    ...policyConfig.runtimeBundle,
    ...input.policy,
  };
  if (!policyConfig.memoryEnabled) {
    return buildMemoryBundle([], policy, {
      degraded: true,
      reason: "memory_disabled",
    });
  }
  const allowedScopes = (["repository", "workspace", "user_prefs"] as const)
    .filter((scope) => policyConfig.allowedScopes[scope])
    .filter(
      (scope) =>
        scope !== "user_prefs" ||
        (policy.includeUserPrefs && input.userId !== null),
    );
  if (allowedScopes.length === 0) return buildMemoryBundle([], policy);
  const selection: ListActiveMemoryForBundleInput = {
    workspaceId: input.workspaceId,
    repositoryId: input.repositoryId,
    userId: input.userId,
    allowedScopes,
    activeAt: currentTime(dependencies),
    limit: policy.maxItems * 5,
  };
  let degradedReason: string | null = null;
  const safeQuery = normalizeSafeRetrievalQuery(input.safeRetrievalQuery);
  if (safeQuery && dependencies.memorySearchIndex) {
    const searched = await searchBundleCandidates(
      safeQuery,
      selection,
      dependencies,
      policy,
    );
    if (searched.status === "found") {
      return buildMemoryBundle(searched.items, policy, {
        preserveInputOrder: true,
      });
    }
    if (searched.status === "degraded") degradedReason = searched.reason;
  }

  const fallbackSelection = {
    ...selection,
    activeAt: currentTime(dependencies),
  };
  const items =
    await dependencies.memoryItems.listActiveForBundle(fallbackSelection);
  return buildMemoryBundle(
    items.filter((item) =>
      isAuthorizedCurrentItem(item, {
        ...fallbackSelection,
        activeAt: currentTime(dependencies),
      }),
    ),
    policy,
    { degraded: degradedReason !== null, reason: degradedReason },
  );
}

async function searchBundleCandidates(
  safeQuery: string,
  selection: ListActiveMemoryForBundleInput,
  dependencies: BundleDependencies,
  policy: MemoryBundlePolicy,
): Promise<
  | { readonly status: "found"; readonly items: readonly MemoryItemSnapshot[] }
  | { readonly status: "empty" }
  | { readonly status: "degraded"; readonly reason: string }
> {
  const searchIndex = dependencies.memorySearchIndex;
  if (!searchIndex) return { status: "empty" };
  try {
    return await withinRetrievalDeadline(async (controls) => {
      const capabilities = await searchIndex.supports(controls);
      controls.signal?.throwIfAborted();
      if (!supportsRuntimeRetrieval(capabilities.capabilities)) {
        return {
          status: "degraded",
          reason: "memory_search_index_unavailable",
        };
      }
      const hits = await searchIndex.search(
        {
          workspaceId: selection.workspaceId,
          repositoryId: selection.repositoryId,
          userId: selection.userId,
          allowedScopes: selection.allowedScopes,
          safeQuery,
          includeUserPrefs: policy.includeUserPrefs,
          limit: selection.limit,
        },
        controls,
      );
      controls.signal?.throwIfAborted();
      if (hits.length === 0) return { status: "empty" };
      // Bound untrusted adapter output before touching the canonical repository.
      const boundedHits = hits.slice(0, selection.limit);
      const itemIds = [...new Set(boundedHits.map((hit) => hit.memoryItemId))];
      const canonical = await dependencies.memoryItems.listActiveByIdsForBundle(
        {
          ...selection,
          activeAt: currentTime(dependencies),
          itemIds,
        },
      );
      controls.signal?.throwIfAborted();
      const byId = new Map(canonical.map((item) => [item.id, item]));
      const finalSelection = {
        ...selection,
        activeAt: currentTime(dependencies),
      };
      // Queryability belongs to this adapter. Legacy canonical index flags can
      // describe a previous engine or be overwritten by a concurrent same-body
      // edit; exact canonical revision and policy remain the authority here.
      const selected = new Map<string, MemoryItemSnapshot>();
      for (const hit of boundedHits) {
        const item = byId.get(hit.memoryItemId);
        if (
          item &&
          isAuthorizedCurrentItem(item, finalSelection) &&
          item.scope === hit.scope &&
          item.bodyVersion === hit.bodyVersion &&
          item.bodyHash === hit.bodyHash
        )
          selected.set(item.id, item);
      }
      if (selected.size === 0) {
        return { status: "degraded", reason: "memory_search_index_stale" };
      }
      return { status: "found", items: [...selected.values()] };
    });
  } catch {
    // Provider errors can contain the body, query or credentials. Only this
    // application-owned code crosses the public bundle/log boundary.
    return { status: "degraded", reason: "memory_search_index_unavailable" };
  }
}

function currentTime(dependencies: BundleDependencies): Date {
  return dependencies.clock?.now() ?? new Date();
}

function isAuthorizedCurrentItem(
  item: MemoryItemSnapshot,
  selection: ListActiveMemoryForBundleInput,
): boolean {
  if (
    item.workspaceId !== selection.workspaceId ||
    item.status !== "active" ||
    !selection.allowedScopes.includes(item.scope) ||
    (item.expiresAt !== null && item.expiresAt <= selection.activeAt)
  )
    return false;
  if (item.scope === "workspace")
    return item.repositoryId === null && item.userId === null;
  if (item.scope === "repository")
    return item.repositoryId === selection.repositoryId && item.userId === null;
  return (
    selection.userId !== null &&
    item.repositoryId === null &&
    item.userId === selection.userId
  );
}

async function withinRetrievalDeadline<T>(
  operation: (controls: MemorySearchRequestControls) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const controls = {
    deadlineAtMs: Date.now() + retrievalBudgetMs,
    signal: controller.signal,
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("memory_search_deadline"));
    }, retrievalBudgetMs);
  });
  try {
    return await Promise.race([operation(controls), timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function normalizeSafeRetrievalQuery(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 500 ? normalized : "";
}

const runtimeRetrievalCapabilities: ReadonlySet<MemorySearchCapability> =
  new Set(["lexical", "full_text", "semantic_vector", "hybrid"]);

function supportsRuntimeRetrieval(
  capabilities: readonly MemorySearchCapability[],
): boolean {
  return capabilities.some((capability) =>
    runtimeRetrievalCapabilities.has(capability),
  );
}
