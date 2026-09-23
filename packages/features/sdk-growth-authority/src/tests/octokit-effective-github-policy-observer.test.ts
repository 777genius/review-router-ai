import { describe, expect, it } from "vitest";
import { SDK_GROWTH_CHECK_NAME } from "../application/check-identity-policy.js";
import { readEffectiveSdkGrowthGitHubPolicy } from "../application/effective-github-policy.js";
import {
  OctokitEffectiveGitHubPolicyObserver,
  type EffectivePolicyGitHubRequester,
} from "../infrastructure/github/octokit-effective-github-policy-observer.js";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const requirement = {
  repositoryId: "1001",
  repositoryFullName: "agent-teams-ai/alpha",
  targetRef: "refs/heads/main",
  targetSha: sha,
  appId: "987654",
  maxObservationAgeMs: 30_000,
} as const;

describe("OctokitEffectiveGitHubPolicyObserver", () => {
  it("normalizes inherited rules, effective branch rules and applicable classic protection", async () => {
    const github = fixtureRequester({ classicProtection: classicProtection() });
    const observer = new OctokitEffectiveGitHubPolicyObserver(
      github,
      () => 12_345,
    );

    const result = await observer.observe(
      requirement,
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      kind: "observed",
      value: {
        repositoryId: "1001",
        defaultBranchRef: "refs/heads/main",
        targetRef: "refs/heads/main",
        targetShaAtStart: sha,
        targetShaAtEnd: sha,
        observedAt: 12_345,
        rulesets: [
          {
            id: "77",
            sourceType: "organization",
            enforcement: "active",
            bypassActors: [],
            rules: [
              {
                type: "required-status-checks",
                strict: true,
                enforceOnCreation: true,
                checks: [
                  {
                    context: SDK_GROWTH_CHECK_NAME,
                    integrationId: "987654",
                  },
                ],
              },
              { type: "pull-request" },
              { type: "non-fast-forward" },
              { type: "deletion" },
            ],
          },
        ],
        classicProtection: {
          requiredChecks: [
            {
              context: SDK_GROWTH_CHECK_NAME,
              integrationId: "987654",
            },
          ],
          strict: true,
          enforceAdmins: true,
          pullRequestRequired: true,
          forcePushesAllowed: false,
          deletionsAllowed: false,
        },
      },
    });
    expect(
      result.kind === "observed" ? result.value.effectiveRules : [],
    ).toContainEqual({
      rulesetId: "77",
      type: "required-status-checks",
      strict: true,
      enforceOnCreation: true,
      checks: [
        {
          context: SDK_GROWTH_CHECK_NAME,
          integrationId: "987654",
        },
      ],
    });
    expect(
      github.calls.find(
        ({ route }) => route === "GET /repos/{owner}/{repo}/rulesets",
      )?.parameters,
    ).toMatchObject({
      includes_parents: true,
      targets: "branch",
      per_page: 100,
      page: 1,
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    });
    expect(
      github.calls.find(({ route }) => route.endsWith("/{ruleset_id}"))
        ?.parameters,
    ).toMatchObject({ includes_parents: true });
  });

  it("holds a full page without provider pagination proof", async () => {
    const github = fixtureRequester({
      rulesetList: Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        source_type: "Repository",
      })),
    });
    const observer = new OctokitEffectiveGitHubPolicyObserver(github);

    await expect(
      observer.observe(requirement, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "PROVIDER_PAGINATION_INCOMPLETE",
    });
    expect(github.calls).toHaveLength(3);
  });

  it.each([
    ["not a valid Link header", [{ id: 77, source_type: "Organization" }]],
    [
      '<https://api.github.test/repositories/1001/rulesets?per_page=100&page=2>; rel="last"',
      [{ id: 77, source_type: "Organization" }],
    ],
    [
      '<https://api.github.test/repositories/1001/rulesets?per_page=100&page=1>; rel="last"',
      Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        source_type: "Repository",
      })),
    ],
  ] as const)(
    "holds malformed or ambiguous pagination proof %s",
    async (link, rulesetList) => {
      const github = fixtureRequester({ rulesetList, rulesetListLink: link });

      await expect(
        new OctokitEffectiveGitHubPolicyObserver(github).observe(
          requirement,
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({
        kind: "unknown",
        reason: "PROVIDER_PAGINATION_INCOMPLETE",
      });
    },
  );

  it.each([
    [
      "ruleset list",
      {
        rulesetPages: {
          1: {
            data: rulesetSummaries(1, 100),
            link: paginationLink({ next: 2, last: 3 }),
          },
          2: {
            data: [],
            link: paginationLink({ prev: 1, first: 1 }),
          },
        },
      },
      "GET /repos/{owner}/{repo}/rulesets",
    ],
    [
      "effective-rule list",
      {
        effectiveRulePages: {
          1: {
            data: distinctEffectiveRules(100),
            link: paginationLink({ next: 2, last: 3 }),
          },
          2: {
            data: [],
            link: paginationLink({ prev: 1, first: 1 }),
          },
        },
      },
      "GET /repos/{owner}/{repo}/rules/branches/{branch}",
    ],
  ] as const)(
    "holds when %s terminates before its advertised last page",
    async (_name, options, paginatedRoute) => {
      const github = fixtureRequester(options);

      const result = await readEffectiveSdkGrowthGitHubPolicy({
        requirement,
        observer: new OctokitEffectiveGitHubPolicyObserver(github),
        signal: new AbortController().signal,
      });

      expect(result).toMatchObject({
        verdict: "HOLD",
        reasons: ["PROVIDER_PAGINATION_INCOMPLETE"],
        operationalControlBoundary: {
          verdict: "HOLD",
          reasons: [
            "APP_RUNTIME_CUSTODY_UNPROVEN",
            "RULESET_ADMIN_CUSTODY_UNPROVEN",
          ],
        },
        atomicMergeBoundary: {
          verdict: "HOLD",
          reasons: [
            "SAME_SHA_AUTHORITY_REVOCATION_NOT_ATOMIC",
            "PROVIDER_MERGE_LINEARIZATION_UNPROVEN",
          ],
        },
      });
      expect(
        github.calls
          .filter(({ route }) => route === paginatedRoute)
          .map(({ parameters }) => parameters.page),
      ).toEqual([1, 2]);
    },
  );

  it.each([
    ["page cycle", paginationLink({ next: 1, prev: 1, first: 1, last: 3 })],
    [
      "duplicate next page",
      paginationLink({ next: 2, prev: 1, first: 1, last: 3 }),
    ],
    [
      "gap before the next page",
      paginationLink({ next: 4, prev: 1, first: 1, last: 4 }),
    ],
    [
      "conflicting first page",
      paginationLink({ next: 3, prev: 1, first: 2, last: 3 }),
    ],
    [
      "conflicting previous page",
      paginationLink({ next: 3, prev: 2, first: 1, last: 3 }),
    ],
    ["missing first page", paginationLink({ next: 3, prev: 1, last: 3 })],
    ["missing previous page", paginationLink({ next: 3, first: 1, last: 3 })],
    [
      "changed advertised last page",
      paginationLink({ next: 3, prev: 1, first: 1, last: 4 }),
    ],
  ] as const)("holds a %s relationship on page two", async (_name, link) => {
    const github = fixtureRequester({
      rulesetPages: {
        1: {
          data: rulesetSummaries(1, 100),
          link: paginationLink({ next: 2, last: 3 }),
        },
        2: { data: rulesetSummaries(101, 100), link },
      },
    });

    await expect(
      new OctokitEffectiveGitHubPolicyObserver(github).observe(
        requirement,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "PROVIDER_PAGINATION_INCOMPLETE",
    });
  });

  it("accepts consistent pagination through the advertised terminal page", async () => {
    const github = fixtureRequester({
      effectiveRulePages: {
        1: {
          data: distinctEffectiveRules(100),
          link: paginationLink({ next: 2, last: 2 }),
        },
        2: {
          data: [],
          link: paginationLink({ prev: 1, first: 1 }),
        },
      },
    });

    await expect(
      new OctokitEffectiveGitHubPolicyObserver(github).observe(
        requirement,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ kind: "observed" });
  });

  it("holds when effective required-check parameters are missing", async () => {
    const github = fixtureRequester({
      effectiveRules: [{ ruleset_id: 77, type: "required_status_checks" }],
    });

    await expect(
      new OctokitEffectiveGitHubPolicyObserver(github).observe(
        requirement,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "PROVIDER_RESPONSE_INVALID",
    });
  });

  it("timestamps before provider reads so a slow read becomes stale", async () => {
    let clock = 1_000;
    const github = fixtureRequester({
      onRequest: () => {
        clock += 15_000;
      },
    });
    const observer = new OctokitEffectiveGitHubPolicyObserver(
      github,
      () => clock,
    );

    const result = await readEffectiveSdkGrowthGitHubPolicy({
      requirement,
      observer,
      signal: new AbortController().signal,
      now: () => clock,
    });

    expect(clock).toBeGreaterThan(100_000);
    expect(result.verdict).toBe("HOLD");
    expect(result.reasons).toContain("OBSERVATION_STALE");
    expect(result.evidence.observedAt).toBe(1_000);
  });

  it("canonicalizes same-category rules before policy hashing", async () => {
    const detail = rulesetDetail();
    const extraRules = [
      { type: "required_deployments" },
      { type: "code_scanning" },
    ];
    const observers = [extraRules, [...extraRules].reverse()].map(
      (orderedExtraRules) =>
        new OctokitEffectiveGitHubPolicyObserver(
          fixtureRequester({
            rulesetDetail: {
              ...detail,
              rules: [...detail.rules, ...orderedExtraRules],
            },
          }),
          () => 19_000,
        ),
    );

    const [first, second] = await Promise.all(
      observers.map((observer) =>
        readEffectiveSdkGrowthGitHubPolicy({
          requirement,
          observer,
          signal: new AbortController().signal,
          now: () => 20_000,
        }),
      ),
    );

    expect(first?.verdict).toBe("QUALIFIED");
    expect(second?.verdict).toBe("QUALIFIED");
    expect(first?.evidence.policyDigest).toBe(second?.evidence.policyDigest);
  });

  it("holds inaccessible inherited ruleset details and retains provider IDs", async () => {
    const github = fixtureRequester({ detailErrorStatus: 403 });
    const observer = new OctokitEffectiveGitHubPolicyObserver(
      github,
      () => 55_000,
    );

    await expect(
      observer.observe(requirement, new AbortController().signal),
    ).resolves.toEqual({
      kind: "unknown",
      reason: "INHERITED_RULESET_INCOMPLETE",
      observedAt: 55_000,
      providerRulesetIds: ["77"],
      inheritedRulesetIds: ["77"],
      classicProtectionObserved: false,
    });
  });

  it("holds when the target ref changes during observation", async () => {
    const github = fixtureRequester({ endingSha: otherSha });
    const observer = new OctokitEffectiveGitHubPolicyObserver(github);

    await expect(
      observer.observe(requirement, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "TARGET_REF_CHANGED",
      providerRulesetIds: ["77"],
      inheritedRulesetIds: ["77"],
    });
  });

  it("holds a branch already stale at the beginning of the observation", async () => {
    const github = fixtureRequester({ startingSha: otherSha });
    const observer = new OctokitEffectiveGitHubPolicyObserver(github);

    await expect(
      observer.observe(requirement, new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "TARGET_SHA_MISMATCH",
    });
    expect(github.calls.some(({ route }) => route.includes("rulesets"))).toBe(
      false,
    );
  });

  it("does not treat malformed or access-denied classic protection as absence", async () => {
    const denied = fixtureRequester({ classicProtectionErrorStatus: 403 });
    await expect(
      new OctokitEffectiveGitHubPolicyObserver(denied).observe(
        requirement,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "PROVIDER_INACCESSIBLE",
    });

    const malformed = fixtureRequester({ classicProtection: {} });
    await expect(
      new OctokitEffectiveGitHubPolicyObserver(malformed).observe(
        requirement,
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "PROVIDER_RESPONSE_INVALID",
    });
  });
});

class FakeRequester implements EffectivePolicyGitHubRequester {
  readonly calls: Array<{
    readonly route: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  }> = [];

  constructor(
    private readonly handle: (
      route: string,
      parameters: Readonly<Record<string, unknown>>,
    ) => Readonly<{ data: unknown; headers?: unknown }>,
  ) {}

  async request(route: string, parameters: Readonly<Record<string, unknown>>) {
    this.calls.push({ route, parameters });
    return this.handle(route, parameters);
  }
}

function fixtureRequester(
  options: Readonly<{
    startingSha?: string;
    endingSha?: string;
    rulesetList?: readonly unknown[];
    rulesetListLink?: string;
    rulesetPages?: Readonly<Record<number, PaginatedFixture>>;
    rulesetDetail?: unknown;
    effectiveRules?: readonly unknown[];
    effectiveRulePages?: Readonly<Record<number, PaginatedFixture>>;
    detailErrorStatus?: number;
    classicProtection?: unknown;
    classicProtectionErrorStatus?: number;
    onRequest?: () => void;
  }> = {},
) {
  let refReads = 0;
  return new FakeRequester((route, parameters) => {
    options.onRequest?.();
    if (route === "GET /repos/{owner}/{repo}") {
      return {
        data: {
          id: 1001,
          full_name: "agent-teams-ai/alpha",
          default_branch: "main",
        },
      };
    }
    if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}") {
      refReads += 1;
      return {
        data: {
          object: {
            sha:
              refReads === 1
                ? (options.startingSha ?? sha)
                : (options.endingSha ?? sha),
          },
        },
      };
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets") {
      const pageFixture = options.rulesetPages?.[Number(parameters.page)];
      if (pageFixture) return paginatedResponse(pageFixture);
      return {
        data: options.rulesetList ?? [{ id: 77, source_type: "Organization" }],
        headers:
          options.rulesetListLink === undefined
            ? undefined
            : { link: options.rulesetListLink },
      };
    }
    if (route === "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}") {
      if (options.detailErrorStatus) throw httpError(options.detailErrorStatus);
      return { data: options.rulesetDetail ?? rulesetDetail() };
    }
    if (route === "GET /repos/{owner}/{repo}/rules/branches/{branch}") {
      const pageFixture = options.effectiveRulePages?.[Number(parameters.page)];
      if (pageFixture) return paginatedResponse(pageFixture);
      return {
        data: options.effectiveRules ?? requiredEffectiveRules(),
      };
    }
    if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") {
      if (options.classicProtectionErrorStatus) {
        throw httpError(options.classicProtectionErrorStatus);
      }
      if (options.classicProtection !== undefined) {
        return { data: options.classicProtection };
      }
      throw httpError(404);
    }
    throw new Error(`unexpected route: ${route}`);
  });
}

type PaginatedFixture = Readonly<{
  data: readonly unknown[];
  link?: string;
}>;

function paginatedResponse(fixture: PaginatedFixture) {
  return {
    data: fixture.data,
    headers: fixture.link === undefined ? undefined : { link: fixture.link },
  };
}

function paginationLink(
  relationships: Readonly<
    Partial<Record<"next" | "prev" | "first" | "last", number>>
  >,
): string {
  return Object.entries(relationships)
    .map(
      ([relationship, page]) =>
        `<https://api.github.test/paginated?per_page=100&page=${page}>; rel="${relationship}"`,
    )
    .join(", ");
}

function rulesetSummaries(startId: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: startId + index,
    source_type: "Repository",
  }));
}

function distinctEffectiveRules(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    ruleset_id: 77,
    type: `fixture_rule_${index}`,
  }));
}

function requiredEffectiveRules() {
  return [
    {
      ruleset_id: 77,
      type: "required_status_checks",
      parameters: {
        required_status_checks: [
          {
            context: SDK_GROWTH_CHECK_NAME,
            integration_id: 987654,
          },
        ],
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
      },
    },
    { ruleset_id: 77, type: "pull_request" },
    { ruleset_id: 77, type: "non_fast_forward" },
    { ruleset_id: 77, type: "deletion" },
  ];
}

function rulesetDetail() {
  return {
    id: 77,
    name: "SDK growth gate",
    source_type: "Organization",
    source: "agent-teams-ai",
    enforcement: "active",
    conditions: {
      ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] },
    },
    bypass_actors: [],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [
            {
              context: SDK_GROWTH_CHECK_NAME,
              integration_id: 987654,
            },
          ],
          strict_required_status_checks_policy: true,
          do_not_enforce_on_create: false,
        },
      },
      { type: "pull_request" },
      { type: "non_fast_forward" },
      { type: "deletion" },
    ],
  };
}

function classicProtection() {
  return {
    required_status_checks: {
      strict: true,
      checks: [{ context: SDK_GROWTH_CHECK_NAME, app_id: 987654 }],
    },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
    },
    restrictions: { users: [], teams: [], apps: [] },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  };
}

function httpError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}
