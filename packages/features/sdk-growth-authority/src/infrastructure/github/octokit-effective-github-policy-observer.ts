import type {
  EffectiveGitHubPolicyObservationResult,
  EffectiveGitHubPolicyObserverPort,
} from "../../application/ports/effective-github-policy-observer-port.js";
import type {
  EffectiveGitHubPolicyHoldReason,
  EffectiveGitHubPolicyObservation,
  EffectiveGitHubPolicyRequirement,
  GitHubRulesetEnforcement,
  GitHubRulesetSourceType,
  NormalizedClassicBranchProtection,
  NormalizedEffectiveRule,
  NormalizedGitHubRule,
  NormalizedGitHubRuleset,
  NormalizedRequiredStatusCheck,
  NormalizedRulesetBypassActor,
} from "../../domain/effective-github-policy.js";

export interface EffectivePolicyGitHubRequester {
  request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
  ): Promise<
    Readonly<{
      data: unknown;
      headers?: unknown;
    }>
  >;
}

type RulesetSummary = Readonly<{
  id: string;
  sourceType: GitHubRulesetSourceType;
}>;

type ObservationHoldReason = Extract<
  EffectiveGitHubPolicyHoldReason,
  | "PROVIDER_INACCESSIBLE"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_PAGINATION_INCOMPLETE"
  | "TARGET_REF_MISSING"
  | "TARGET_SHA_MISMATCH"
  | "TARGET_REF_CHANGED"
  | "RULESET_DETAIL_INACCESSIBLE"
  | "INHERITED_RULESET_INCOMPLETE"
>;

const apiVersion = "2026-03-10";
const pageSize = 100;
const maxPages = 100;

/** Provider transport and strict response normalization only. */
export class OctokitEffectiveGitHubPolicyObserver implements EffectiveGitHubPolicyObserverPort {
  constructor(
    private readonly octokit: EffectivePolicyGitHubRequester,
    private readonly now: () => number = Date.now,
  ) {}

  async observe(
    requirement: EffectiveGitHubPolicyRequirement,
    signal: AbortSignal,
  ): Promise<EffectiveGitHubPolicyObservationResult> {
    // The oldest instant contributing to the result bounds its freshness.
    // Completion time would let slow provider reads manufacture a fresh value.
    const observationStartedAt = this.now();
    const [owner, repo] = splitFullName(requirement.repositoryFullName);
    const branch = branchFromRef(requirement.targetRef);
    const gitRef = requirement.targetRef.slice("refs/".length);
    const providerRulesetIds = new Set<string>();
    const inheritedRulesetIds = new Set<string>();
    let classicProtectionObserved = false;
    try {
      const repository = await this.request(
        "GET /repos/{owner}/{repo}",
        { owner, repo },
        signal,
      );
      const repositoryRecord = record(repository.data);
      const repositoryId = numericId(
        repositoryRecord.id,
        "PROVIDER_RESPONSE_INVALID",
      );
      const fullName = string(
        repositoryRecord.full_name,
        "PROVIDER_RESPONSE_INVALID",
      );
      const defaultBranch = string(
        repositoryRecord.default_branch,
        "PROVIDER_RESPONSE_INVALID",
      );
      if (
        repositoryId !== requirement.repositoryId ||
        fullName.toLowerCase() !== requirement.repositoryFullName.toLowerCase()
      ) {
        throw new ObservationError("PROVIDER_RESPONSE_INVALID");
      }

      const targetShaAtStart = await this.readRefSha(
        owner,
        repo,
        gitRef,
        signal,
      );
      if (targetShaAtStart !== requirement.targetSha) {
        throw new ObservationError("TARGET_SHA_MISMATCH");
      }

      const summaries = [
        ...(await this.readAllPages(
          "GET /repos/{owner}/{repo}/rulesets",
          { owner, repo, includes_parents: true, targets: "branch" },
          signal,
          parseRulesetSummary,
        )),
      ].sort((left, right) => compareNumericIds(left.id, right.id));
      for (const summary of summaries) {
        if (providerRulesetIds.has(summary.id)) {
          throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
        }
        providerRulesetIds.add(summary.id);
        if (summary.sourceType !== "repository") {
          inheritedRulesetIds.add(summary.id);
        }
      }

      const rulesets: NormalizedGitHubRuleset[] = [];
      for (const summary of summaries) {
        let response;
        try {
          response = await this.request(
            "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}",
            {
              owner,
              repo,
              ruleset_id: summary.id,
              includes_parents: true,
            },
            signal,
          );
        } catch (error) {
          if (error instanceof ObservationError) throw error;
          const status = httpStatus(error);
          if (status === 401 || status === 403 || status === 404) {
            throw new ObservationError(
              summary.sourceType === "repository"
                ? "RULESET_DETAIL_INACCESSIBLE"
                : "INHERITED_RULESET_INCOMPLETE",
            );
          }
          throw error;
        }
        let detail: NormalizedGitHubRuleset;
        try {
          detail = parseRuleset(response.data);
        } catch (error) {
          if (error instanceof ObservationError) throw error;
          throw new ObservationError("PROVIDER_RESPONSE_INVALID");
        }
        if (
          detail.id !== summary.id ||
          detail.sourceType !== summary.sourceType
        ) {
          throw new ObservationError(
            summary.sourceType === "repository"
              ? "PROVIDER_RESPONSE_INVALID"
              : "INHERITED_RULESET_INCOMPLETE",
          );
        }
        rulesets.push(detail);
      }

      const effectiveRules = [
        ...(await this.readAllPages(
          "GET /repos/{owner}/{repo}/rules/branches/{branch}",
          { owner, repo, branch },
          signal,
          parseEffectiveRule,
        )),
      ].sort(compareEffectiveRules);
      assertNoConflictingEffectiveRules(effectiveRules);
      for (const rule of effectiveRules) {
        if (!providerRulesetIds.has(rule.rulesetId)) {
          throw new ObservationError("INHERITED_RULESET_INCOMPLETE");
        }
      }

      const classicProtection = await this.readClassicProtection(
        owner,
        repo,
        branch,
        signal,
      );
      classicProtectionObserved = classicProtection !== null;

      const targetShaAtEnd = await this.readRefSha(owner, repo, gitRef, signal);
      if (targetShaAtEnd !== targetShaAtStart) {
        throw new ObservationError("TARGET_REF_CHANGED");
      }

      const value: EffectiveGitHubPolicyObservation = {
        repositoryId,
        repositoryFullName: fullName,
        defaultBranchRef: `refs/heads/${defaultBranch}`,
        targetRef: requirement.targetRef,
        targetShaAtStart,
        targetShaAtEnd,
        observedAt: observationStartedAt,
        rulesets,
        effectiveRules,
        classicProtection,
      };
      return { kind: "observed", value };
    } catch (error) {
      const reason = observationReason(error);
      return {
        kind: "unknown",
        reason,
        observedAt: observationStartedAt,
        providerRulesetIds: [...providerRulesetIds].sort(),
        inheritedRulesetIds: [...inheritedRulesetIds].sort(),
        classicProtectionObserved,
      };
    }
  }

  private async readRefSha(
    owner: string,
    repo: string,
    ref: string,
    signal: AbortSignal,
  ): Promise<string> {
    let response;
    try {
      response = await this.request(
        "GET /repos/{owner}/{repo}/git/ref/{ref}",
        { owner, repo, ref },
        signal,
      );
    } catch (error) {
      if (httpStatus(error) === 404) {
        throw new ObservationError("TARGET_REF_MISSING");
      }
      throw error;
    }
    const object = record(record(response.data).object);
    const sha = string(object.sha, "PROVIDER_RESPONSE_INVALID").toLowerCase();
    if (!/^[a-f0-9]{40}$/u.test(sha)) {
      throw new ObservationError("PROVIDER_RESPONSE_INVALID");
    }
    return sha;
  }

  private async readClassicProtection(
    owner: string,
    repo: string,
    branch: string,
    signal: AbortSignal,
  ): Promise<NormalizedClassicBranchProtection | null> {
    try {
      const response = await this.request(
        "GET /repos/{owner}/{repo}/branches/{branch}/protection",
        { owner, repo, branch },
        signal,
      );
      return parseClassicProtection(response.data);
    } catch (error) {
      if (httpStatus(error) === 404) return null;
      if ([401, 403].includes(httpStatus(error))) {
        throw new ObservationError("PROVIDER_INACCESSIBLE");
      }
      throw error;
    }
  }

  private async readAllPages<T>(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
    parseItem: (value: unknown) => T,
  ): Promise<readonly T[]> {
    const all: T[] = [];
    let advertisedLastPage: number | null = null;
    for (let page = 1; page <= maxPages; page += 1) {
      const response = await this.request(
        route,
        { ...parameters, per_page: pageSize, page },
        signal,
      );
      if (!Array.isArray(response.data) || response.data.length > pageSize) {
        throw new ObservationError("PROVIDER_RESPONSE_INVALID");
      }
      const link = responseHeader(response.headers, "link");
      if (page > 1 && link === null) {
        throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
      }
      const relationships =
        link === null ? null : parsePaginationLinks(link, page);
      const linkedLastPage = relationships?.last;
      if (linkedLastPage !== undefined) {
        if (
          advertisedLastPage !== null &&
          advertisedLastPage !== linkedLastPage
        ) {
          throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
        }
        advertisedLastPage = linkedLastPage;
      }
      if (
        advertisedLastPage !== null &&
        (page > advertisedLastPage ||
          (page < advertisedLastPage && relationships?.next === undefined))
      ) {
        throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
      }
      const hasNext = relationships?.next !== undefined;
      if (response.data.length < pageSize && hasNext) {
        throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
      }
      for (const item of response.data) all.push(parseItem(item));
      if (
        response.data.length < pageSize &&
        !hasNext &&
        (advertisedLastPage === null || advertisedLastPage === page)
      ) {
        return all;
      }
      if (response.data.length === pageSize && !hasNext) {
        throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
      }
    }
    throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
  }

  private request(
    route: string,
    parameters: Readonly<Record<string, unknown>>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    return this.octokit.request(route, {
      ...parameters,
      headers: {
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": apiVersion,
      },
      request: { signal },
    });
  }
}

function parseRulesetSummary(value: unknown): RulesetSummary {
  const source = record(value);
  return {
    id: numericId(source.id, "PROVIDER_RESPONSE_INVALID"),
    sourceType: rulesetSourceType(source.source_type),
  };
}

function parseRuleset(value: unknown): NormalizedGitHubRuleset {
  const source = record(value);
  const conditions = record(source.conditions);
  const refName = record(conditions.ref_name);
  return {
    id: numericId(source.id, "PROVIDER_RESPONSE_INVALID"),
    name: string(source.name, "PROVIDER_RESPONSE_INVALID"),
    sourceType: rulesetSourceType(source.source_type),
    source: string(source.source, "PROVIDER_RESPONSE_INVALID"),
    enforcement: rulesetEnforcement(source.enforcement),
    refIncludes: sortedUniqueStrings(stringArray(refName.include)),
    refExcludes: sortedUniqueStrings(stringArray(refName.exclude)),
    bypassActors: array(source.bypass_actors)
      .map(parseBypassActor)
      .sort((left, right) =>
        compareText(JSON.stringify(left), JSON.stringify(right)),
      ),
    rules: array(source.rules).map(parseRule).sort(compareRules),
  };
}

function parseBypassActor(value: unknown): NormalizedRulesetBypassActor {
  const source = record(value);
  const actorType = rulesetActorType(source.actor_type);
  const actorId =
    source.actor_id === null
      ? null
      : numericId(source.actor_id, "PROVIDER_RESPONSE_INVALID");
  if (
    source.bypass_mode !== "always" &&
    source.bypass_mode !== "pull_request"
  ) {
    throw new ObservationError("PROVIDER_RESPONSE_INVALID");
  }
  return {
    actorType,
    actorId,
    bypassMode:
      source.bypass_mode === "pull_request" ? "pull-request" : "always",
  };
}

function parseRule(value: unknown): NormalizedGitHubRule {
  const source = record(value);
  const type = string(source.type, "PROVIDER_RESPONSE_INVALID");
  if (type === "required_status_checks") {
    const parameters = record(source.parameters);
    const strict = boolean(
      parameters.strict_required_status_checks_policy,
      "PROVIDER_RESPONSE_INVALID",
    );
    const doNotEnforceOnCreate = boolean(
      parameters.do_not_enforce_on_create,
      "PROVIDER_RESPONSE_INVALID",
    );
    return {
      type: "required-status-checks",
      checks: array(parameters.required_status_checks)
        .map(parseRequiredCheck)
        .sort((left, right) =>
          compareText(JSON.stringify(left), JSON.stringify(right)),
        ),
      strict,
      enforceOnCreation: !doNotEnforceOnCreate,
    };
  }
  if (type === "pull_request") return { type: "pull-request" };
  if (type === "non_fast_forward") return { type: "non-fast-forward" };
  if (type === "deletion") return { type: "deletion" };
  return { type: "other", providerType: type };
}

function parseRequiredCheck(value: unknown): NormalizedRequiredStatusCheck {
  const source = record(value);
  return {
    context: string(source.context, "PROVIDER_RESPONSE_INVALID"),
    integrationId:
      !Object.hasOwn(source, "integration_id") ||
      source.integration_id === null ||
      source.integration_id === -1
        ? null
        : numericId(source.integration_id, "PROVIDER_RESPONSE_INVALID"),
  };
}

function parseEffectiveRule(value: unknown): NormalizedEffectiveRule {
  const source = record(value);
  const rulesetId = numericId(source.ruleset_id, "PROVIDER_RESPONSE_INVALID");
  const type = string(source.type, "PROVIDER_RESPONSE_INVALID");
  if (type === "required_status_checks") {
    const parameters = record(source.parameters);
    return {
      rulesetId,
      type: "required-status-checks",
      checks: array(parameters.required_status_checks)
        .map(parseRequiredCheck)
        .sort(compareNormalizedContent),
      strict: boolean(
        parameters.strict_required_status_checks_policy,
        "PROVIDER_RESPONSE_INVALID",
      ),
      enforceOnCreation: !boolean(
        parameters.do_not_enforce_on_create,
        "PROVIDER_RESPONSE_INVALID",
      ),
    };
  }
  if (type === "pull_request") return { rulesetId, type: "pull-request" };
  if (type === "non_fast_forward") {
    return { rulesetId, type: "non-fast-forward" };
  }
  if (type === "deletion") return { rulesetId, type: "deletion" };
  return { rulesetId, type: "other", providerType: type };
}

function parseClassicProtection(
  value: unknown,
): NormalizedClassicBranchProtection {
  const source = record(value);
  const requiredStatusChecks = optionalRecord(source.required_status_checks);
  const requiredChecks = requiredStatusChecks
    ? array(requiredStatusChecks.checks)
        .map(parseClassicRequiredCheck)
        .sort((left, right) =>
          compareText(JSON.stringify(left), JSON.stringify(right)),
        )
    : [];
  const pullRequest = optionalRecord(source.required_pull_request_reviews);
  const bypass = pullRequest
    ? record(pullRequest.bypass_pull_request_allowances)
    : null;
  const restrictions = optionalRecord(source.restrictions);
  return {
    requiredChecks,
    strict: requiredStatusChecks
      ? boolean(requiredStatusChecks.strict, "PROVIDER_RESPONSE_INVALID")
      : false,
    enforceAdmins: boolean(
      record(source.enforce_admins).enabled,
      "PROVIDER_RESPONSE_INVALID",
    ),
    pullRequestRequired: pullRequest !== null,
    pullRequestBypassActors: bypass
      ? [
          ...classicActors(bypass.users, "user"),
          ...classicActors(bypass.teams, "team"),
          ...classicActors(bypass.apps, "integration"),
        ]
      : [],
    pushRestrictionActors: restrictions
      ? [
          ...classicActors(restrictions.users, "user"),
          ...classicActors(restrictions.teams, "team"),
          ...classicActors(restrictions.apps, "integration"),
        ]
      : [],
    forcePushesAllowed: boolean(
      record(source.allow_force_pushes).enabled,
      "PROVIDER_RESPONSE_INVALID",
    ),
    deletionsAllowed: boolean(
      record(source.allow_deletions).enabled,
      "PROVIDER_RESPONSE_INVALID",
    ),
  };
}

function parseClassicRequiredCheck(
  value: unknown,
): NormalizedRequiredStatusCheck {
  const source = record(value);
  return {
    context: string(source.context, "PROVIDER_RESPONSE_INVALID"),
    integrationId:
      !Object.hasOwn(source, "app_id") ||
      source.app_id === null ||
      source.app_id === -1
        ? null
        : numericId(source.app_id, "PROVIDER_RESPONSE_INVALID"),
  };
}

function classicActors(
  value: unknown,
  actorType: "user" | "team" | "integration",
): readonly Readonly<{
  actorType: "user" | "team" | "integration";
  actorId: string;
}>[] {
  return array(value)
    .map((item) => {
      const actor = record(item);
      return {
        actorType,
        actorId: numericId(actor.id, "PROVIDER_RESPONSE_INVALID"),
      };
    })
    .sort((left, right) => compareNumericIds(left.actorId, right.actorId));
}

function assertNoConflictingEffectiveRules(
  rules: readonly NormalizedEffectiveRule[],
): void {
  const identities = new Set<string>();
  for (const rule of rules) {
    const identity = `${rule.rulesetId}:${effectiveProviderType(rule)}`;
    if (identities.has(identity)) {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    identities.add(identity);
  }
}

function rulesetSourceType(value: unknown): GitHubRulesetSourceType {
  if (value === "Repository") return "repository";
  if (value === "Organization") return "organization";
  if (value === "Enterprise") return "enterprise";
  throw new ObservationError("PROVIDER_RESPONSE_INVALID");
}

function rulesetEnforcement(value: unknown): GitHubRulesetEnforcement {
  if (value === "active" || value === "evaluate" || value === "disabled") {
    return value;
  }
  throw new ObservationError("PROVIDER_RESPONSE_INVALID");
}

function rulesetActorType(
  value: unknown,
): NormalizedRulesetBypassActor["actorType"] {
  if (value === "User") return "user";
  if (value === "Team") return "team";
  if (value === "Integration") return "integration";
  if (value === "OrganizationAdmin") return "organization-admin";
  if (value === "RepositoryRole") return "repository-role";
  if (value === "DeployKey") return "deploy-key";
  throw new ObservationError("PROVIDER_RESPONSE_INVALID");
}

function splitFullName(fullName: string): readonly [string, string] {
  const parts = fullName.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ObservationError("PROVIDER_RESPONSE_INVALID");
  }
  return [parts[0], parts[1]];
}

function branchFromRef(ref: string): string {
  const prefix = "refs/heads/";
  if (!ref.startsWith(prefix) || ref.length === prefix.length) {
    throw new ObservationError("PROVIDER_RESPONSE_INVALID");
  }
  return ref.slice(prefix.length);
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ObservationError("PROVIDER_RESPONSE_INVALID");
  }
  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  if (value === null) return null;
  return record(value);
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ObservationError("PROVIDER_RESPONSE_INVALID");
  }
  return value;
}

function string(value: unknown, reason: ObservationHoldReason): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ObservationError(reason);
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  return array(value).map((item) => string(item, "PROVIDER_RESPONSE_INVALID"));
}

function boolean(value: unknown, reason: ObservationHoldReason): boolean {
  if (typeof value !== "boolean") throw new ObservationError(reason);
  return value;
}

function numericId(value: unknown, reason: ObservationHoldReason): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ObservationError(reason);
    }
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value)) {
    try {
      return BigInt(value).toString();
    } catch {
      throw new ObservationError(reason);
    }
  }
  throw new ObservationError(reason);
}

function responseHeader(headers: unknown, name: string): string | null {
  if (headers && typeof headers === "object" && "get" in headers) {
    const getter = (headers as { get(value: string): unknown }).get;
    if (typeof getter === "function") {
      const value = getter.call(headers, name);
      if (value === null || value === undefined) return null;
      if (typeof value === "string") return value;
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
  }
  if (headers && typeof headers === "object" && !Array.isArray(headers)) {
    const source = headers as Readonly<Record<string, unknown>>;
    const matchingKey = Object.keys(source).find(
      (key) => key.toLowerCase() === name.toLowerCase(),
    );
    if (matchingKey === undefined) return null;
    const value = source[matchingKey];
    if (typeof value === "string") return value;
    throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
  }
  return null;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumericIds(left: string, right: string): number {
  return left.length === right.length
    ? compareText(left, right)
    : left.length - right.length;
}

function sortedUniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

function ruleOrder(rule: NormalizedGitHubRule): number {
  if (rule.type === "required-status-checks") return 0;
  if (rule.type === "pull-request") return 1;
  if (rule.type === "non-fast-forward") return 2;
  if (rule.type === "deletion") return 3;
  return 4;
}

function compareRules(
  left: NormalizedGitHubRule,
  right: NormalizedGitHubRule,
): number {
  return (
    ruleOrder(left) - ruleOrder(right) || compareNormalizedContent(left, right)
  );
}

function compareEffectiveRules(
  left: NormalizedEffectiveRule,
  right: NormalizedEffectiveRule,
): number {
  return (
    compareNumericIds(left.rulesetId, right.rulesetId) ||
    compareText(effectiveProviderType(left), effectiveProviderType(right)) ||
    compareNormalizedContent(left, right)
  );
}

function compareNormalizedContent(left: unknown, right: unknown): number {
  return compareText(JSON.stringify(left), JSON.stringify(right));
}

function effectiveProviderType(rule: NormalizedEffectiveRule): string {
  if (rule.type === "required-status-checks") return "required_status_checks";
  if (rule.type === "pull-request") return "pull_request";
  if (rule.type === "non-fast-forward") return "non_fast_forward";
  if (rule.type === "deletion") return "deletion";
  if (rule.type === "other") return rule.providerType;
  throw new Error("unreachable effective rule type");
}

function parsePaginationLinks(
  value: string,
  currentPage: number,
): Readonly<{
  next: number | undefined;
  prev: number | undefined;
  first: number | undefined;
  last: number | undefined;
}> {
  const relationships = new Map<"next" | "prev" | "first" | "last", number>();
  const parts = value.split(",");
  if (parts.length === 0) {
    throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
  }
  for (const part of parts) {
    const match =
      /^\s*<([^<>\s]+)>\s*;\s*rel="(next|prev|first|last)"\s*$/u.exec(part);
    if (!match) {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    const relationship = match[2] as "next" | "prev" | "first" | "last";
    if (relationships.has(relationship)) {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    let url: URL;
    try {
      url = new URL(match[1]!);
    } catch {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    const pageValues = url.searchParams.getAll("page");
    const perPageValues = url.searchParams.getAll("per_page");
    const rawPage = pageValues[0];
    const rawPerPage = perPageValues[0];
    if (
      pageValues.length !== 1 ||
      perPageValues.length !== 1 ||
      !rawPage ||
      !/^[1-9]\d*$/u.test(rawPage) ||
      rawPerPage !== String(pageSize)
    ) {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    const linkedPage = Number(rawPage);
    if (!Number.isSafeInteger(linkedPage)) {
      throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
    }
    relationships.set(relationship, linkedPage);
  }

  const next = relationships.get("next");
  const previous = relationships.get("prev");
  const first = relationships.get("first");
  const last = relationships.get("last");
  if (
    (next !== undefined && next !== currentPage + 1) ||
    (previous !== undefined && previous !== currentPage - 1) ||
    (first !== undefined && first !== 1) ||
    (last !== undefined && last < currentPage) ||
    (next !== undefined && (last === undefined || last < next)) ||
    (next === undefined && last !== undefined && last > currentPage) ||
    (currentPage > 1 && (previous === undefined || first === undefined)) ||
    (currentPage === 1 && previous !== undefined)
  ) {
    throw new ObservationError("PROVIDER_PAGINATION_INCOMPLETE");
  }
  return { next, prev: previous, first, last };
}

function observationReason(error: unknown): ObservationHoldReason {
  if (error instanceof ObservationError) return error.reason;
  return "PROVIDER_INACCESSIBLE";
}

function httpStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 0;
}

class ObservationError extends Error {
  constructor(readonly reason: ObservationHoldReason) {
    super(reason);
  }
}
