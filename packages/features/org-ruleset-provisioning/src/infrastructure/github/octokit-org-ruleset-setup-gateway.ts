import { Buffer } from "node:buffer";
import type {
  OrgRulesetPermissionProbeResult,
  OrgRulesetSetupGatewayPort,
  OrgRulesetWriteResult,
  SourceWorkflowWriteResult,
} from "../../application/ports/org-ruleset-setup-gateway-port";

type GitHubRequester = {
  request: (
    route: string,
    parameters?: Record<string, unknown>,
  ) => Promise<{ data: unknown }>;
};

type GitHubRulesetSummary = {
  readonly id: number;
  readonly name: string;
  readonly _links?: { readonly html?: { readonly href?: string } };
};

const githubRulesetsApiVersion = "2026-03-10";

export class OctokitOrgRulesetSetupGateway implements OrgRulesetSetupGatewayPort {
  constructor(private readonly octokit: GitHubRequester) {}

  async probeOrganizationRulesetAccess(input: {
    readonly organizationLogin: string;
  }): Promise<OrgRulesetPermissionProbeResult> {
    try {
      await this.requestRulesetsApi("GET /orgs/{org}/rulesets", {
        org: input.organizationLogin,
        per_page: 1,
        targets: "branch",
      });
      return { ok: true };
    } catch (error: unknown) {
      const status = getErrorStatus(error);
      if (status === 403) {
        if (isGitHubRulesetsPlanUpgradeError(error)) {
          return {
            ok: false,
            safeErrorCode: "org_rulesets_not_supported",
            safeErrorSummary:
              "GitHub organization rulesets are unavailable on this organization plan. Use per-repository setup PR fallback.",
          };
        }
        return {
          ok: false,
          safeErrorCode: "org_admin_permission_required",
          safeErrorSummary:
            "The installed GitHub App needs Organization Administration: write before ReviewRouter can create or update organization rulesets.",
        };
      }
      if (status === 404) {
        return {
          ok: false,
          safeErrorCode: "org_rulesets_not_supported",
          safeErrorSummary:
            "GitHub organization rulesets are unavailable for this installation, organization, or plan.",
        };
      }
      if (status === 422) {
        return {
          ok: false,
          safeErrorCode: "org_ruleset_permission_update_pending",
          safeErrorSummary:
            "GitHub rejected the ruleset probe. The App permission update may still need approval by an organization owner.",
        };
      }
      throw error;
    }
  }

  async writeSourceWorkflow(
    input: Parameters<OrgRulesetSetupGatewayPort["writeSourceWorkflow"]>[0],
  ): Promise<SourceWorkflowWriteResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      input.signal?.throwIfAborted();
      const existing = await this.readRepositoryFile(input);
      input.signal?.throwIfAborted();
      if (existing.content === input.content) return { sha: existing.sha };

      try {
        await performMutation(input, false, () =>
          this.octokit.request("PUT /repos/{owner}/{repo}/contents/{path}", {
            owner: input.owner,
            repo: input.repo,
            path: input.path,
            branch: input.branch,
            ...(existing.sha ? { sha: existing.sha } : {}),
            message: input.message,
            content: Buffer.from(input.content).toString("base64"),
            request: { signal: input.signal, timeout: 30_000 },
          }),
        );
      } catch (error: unknown) {
        if (attempt === 0 && [409, 422].includes(getErrorStatus(error)))
          continue;
        throw error;
      }
      input.signal?.throwIfAborted();
      const verified = await this.readRepositoryFile(input);
      input.signal?.throwIfAborted();
      if (verified.content !== input.content || !verified.sha) {
        throw new Error("org_ruleset_workflow_readback_mismatch");
      }
      return { sha: verified.sha };
    }
    throw new Error("github_workflow_write_response_invalid");
  }

  async createOrUpdateOrganizationRuleset(
    input: Parameters<
      OrgRulesetSetupGatewayPort["createOrUpdateOrganizationRuleset"]
    >[0],
  ): Promise<OrgRulesetWriteResult> {
    const existing = await this.findRulesetByName(input);
    input.signal?.throwIfAborted();
    if (input.knownRulesetId && String(existing?.id) !== input.knownRulesetId) {
      throw new Error("org_ruleset_known_ruleset_not_found");
    }
    if (existing) {
      const current = await this.readRuleset(
        input.organizationLogin,
        existing.id,
        input.signal,
      );
      if (rulesetMatches(current, input.payload))
        return parseRulesetWriteResult(current);
    }
    const { data } = await performMutation(input, !existing, () =>
      this.requestRulesetsApi(
        existing
          ? "PUT /orgs/{org}/rulesets/{ruleset_id}"
          : "POST /orgs/{org}/rulesets",
        {
          org: input.organizationLogin,
          ...(existing ? { ruleset_id: existing.id } : {}),
          ...input.payload,
        },
        input.signal,
      ),
    );
    const written = parseRulesetWriteResult(data);
    const verified = await this.readRuleset(
      input.organizationLogin,
      written.id,
      input.signal,
    );
    input.signal?.throwIfAborted();
    if (!rulesetMatches(verified, input.payload)) {
      throw new Error("org_ruleset_readback_mismatch");
    }
    return parseRulesetWriteResult(verified);
  }

  private async readRuleset(
    organizationLogin: string,
    id: string | number,
    signal?: AbortSignal,
  ) {
    const { data } = await this.requestRulesetsApi(
      "GET /orgs/{org}/rulesets/{ruleset_id}",
      {
        org: organizationLogin,
        ruleset_id: id,
      },
      signal,
    );
    return data;
  }

  private async readRepositoryFile(input: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly path: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly sha: string | null;
    readonly content: string | null;
  }> {
    try {
      const { data } = await this.octokit.request(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.branch,
          request: { signal: input.signal, timeout: 30_000 },
        },
      );
      return parseRepositoryFile(data);
    } catch (error: unknown) {
      if (getErrorStatus(error) === 404) {
        return { sha: null, content: null };
      }
      throw error;
    }
  }

  private async findRulesetByName(input: {
    readonly organizationLogin: string;
    readonly name: string;
    readonly signal?: AbortSignal;
  }): Promise<GitHubRulesetSummary | null> {
    let match: GitHubRulesetSummary | null = null;
    for (let page = 1; page <= 10; page += 1) {
      const { data } = await this.requestRulesetsApi(
        "GET /orgs/{org}/rulesets",
        {
          org: input.organizationLogin,
          per_page: 100,
          page,
          targets: "branch",
        },
        input.signal,
      );
      if (!Array.isArray(data)) {
        throw new Error("github_ruleset_response_invalid");
      }
      const rulesets = data.map(parseRulesetSummary);
      for (const ruleset of rulesets) {
        if (ruleset.name !== input.name) continue;
        if (match) throw new Error("org_ruleset_duplicate_name");
        match = ruleset;
      }
      if (rulesets.length < 100) return match;
    }
    throw new Error("org_ruleset_discovery_incomplete");
  }

  private async requestRulesetsApi(
    route: string,
    parameters: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<{ data: unknown }> {
    signal?.throwIfAborted();
    const result = await this.octokit.request(route, {
      request: { signal, timeout: 30_000 },
      ...parameters,
      headers: {
        "X-GitHub-Api-Version": githubRulesetsApiVersion,
      },
    });
    return result;
  }
}

function parseRepositoryFile(data: unknown): {
  readonly sha: string | null;
  readonly content: string | null;
} {
  if (Array.isArray(data) || typeof data !== "object" || data === null) {
    return { sha: null, content: null };
  }
  const file = data as {
    readonly type?: unknown;
    readonly sha?: unknown;
    readonly content?: unknown;
  };
  if (file.type !== "file" || typeof file.sha !== "string") {
    return { sha: null, content: null };
  }
  return {
    sha: file.sha,
    content:
      typeof file.content === "string"
        ? Buffer.from(file.content.replaceAll("\n", ""), "base64").toString(
            "utf8",
          )
        : null,
  };
}

function parseRulesetSummary(data: unknown): GitHubRulesetSummary {
  if (typeof data !== "object" || data === null) {
    throw new Error("github_ruleset_response_invalid");
  }
  const ruleset = data as {
    readonly id?: unknown;
    readonly name?: unknown;
    readonly _links?: unknown;
  };
  if (typeof ruleset.id !== "number" || typeof ruleset.name !== "string") {
    throw new Error("github_ruleset_response_invalid");
  }
  return ruleset as GitHubRulesetSummary;
}

function parseRulesetWriteResult(data: unknown): OrgRulesetWriteResult {
  const ruleset = parseRulesetSummary(data);
  return {
    id: String(ruleset.id),
    url: ruleset._links?.html?.href ?? null,
  };
}

function getErrorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 0;
}

function isGitHubRulesetsPlanUpgradeError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String(error.message)
        : "";
  return /upgrade to github team|upgrade.*enterprise|rulesets.*unavailable/i.test(
    message,
  );
}

/** Ignore server metadata at the root, but compare every owned condition/rule. */
function rulesetMatches(actual: unknown, expected: object): boolean {
  if (actual === null || typeof actual !== "object") return false;
  const fields = Object.fromEntries(Object.entries(actual));
  return Object.entries(expected).every(
    ([key, value]) =>
      canonicalRulesetValue(fields[key]) === canonicalRulesetValue(value),
  );
}

function canonicalRulesetValue(value: unknown): string {
  if (Array.isArray(value))
    return JSON.stringify(value.map(canonicalRulesetValue).sort());
  if (value !== null && typeof value === "object") {
    return JSON.stringify(
      Object.entries(value)
        .filter(([key, child]) => !(key === "sha" && child === null))
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, child]) => [key, canonicalRulesetValue(child)]),
    );
  }
  return JSON.stringify(value) ?? "undefined";
}

async function performMutation<T>(
  input: {
    readonly signal?: AbortSignal;
    readonly beforeMutation?: () => Promise<void>;
    readonly beforeCreate?: () => Promise<void>;
    readonly onMutationSettled?: (input: {
      readonly createRejected: boolean;
    }) => Promise<void>;
  },
  create: boolean,
  send: () => Promise<T>,
): Promise<T> {
  let sent = false;
  let createReserved = false;
  let result: T;
  try {
    await input.beforeMutation?.();
    if (create) {
      await input.beforeCreate?.();
      createReserved = true;
    }
    input.signal?.throwIfAborted();
    sent = true;
    result = await send();
  } catch (error) {
    // Local refusal or an explicit rejection proves no write occurred. Timeout,
    // disconnect, 408 and 5xx do not, so their persisted token remains unknown.
    if (
      !sent ||
      [400, 401, 403, 404, 409, 422, 429].includes(getErrorStatus(error))
    ) {
      await input.onMutationSettled?.({
        createRejected: create && createReserved,
      });
    }
    throw error;
  }
  // A known HTTP response closes exactly its token before cancellation is checked.
  // This also runs for a response observed after the caller's deadline expired.
  await input.onMutationSettled?.({ createRejected: false });
  input.signal?.throwIfAborted();
  return result;
}
