/**
 * Harness-only network boundary of the Next server in the provider setup
 * visual qualification, preloaded with `node --import`. It answers the GitHub
 * REST calls the dashboard makes from the fixture document the runner writes
 * (installation tokens, repository metadata and permissions, organization plan, user
 * repository discovery, open setup pull requests, and which repository
 * Actions secrets exist from the run's state file), keeps loopback traffic and
 * fails every other external request as offline. The exact Next development
 * version probe is also blocked, but reported separately from application
 * network violations. Production code runs
 * unchanged; nothing here is reachable outside this preload.
 *
 * Node loads this file with type stripping, so it imports nothing from the
 * repository and uses erasable TypeScript only.
 */
import { appendFileSync, readFileSync } from "node:fs";

type Permission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

type FixtureDocument = {
  readonly organizations: readonly string[];
  readonly installations: readonly {
    readonly id: string;
    readonly accountLogin: string;
  }[];
  readonly users: readonly { readonly id: string; readonly login: string }[];
  readonly repositories: readonly {
    readonly id: string;
    readonly installationId: string;
    readonly owner: string;
    readonly name: string;
    readonly permissions: Readonly<Record<string, Permission>>;
  }[];
  readonly pullRequests: readonly {
    readonly owner: string;
    readonly name: string;
    readonly number: number;
    readonly headRef: string;
    readonly headSha: string;
    readonly baseRef: string;
  }[];
};

const GITHUB_API = "https://api.github.com";
const NEXT_DEVELOPMENT_VERSION_PROBE =
  "https://registry.npmjs.org/-/package/next/dist-tags";
const USER_TOKEN_PREFIX = "rr-visual-fixture-token-";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Facts the runner changes during a run; see GitHubFixtureState. */
type FixtureState = { readonly repositorySecrets: readonly string[] };

const fixturePath = process.env.PROVIDER_VISUAL_GITHUB_FIXTURE;
const statePath = process.env.PROVIDER_VISUAL_GITHUB_STATE;
const networkLog = process.env.PROVIDER_VISUAL_NETWORK_LOG;

/** Read on every request, so a flow can add a secret mid-run. */
function readState(): FixtureState {
  if (!statePath) return { repositorySecrets: [] };
  try {
    return JSON.parse(readFileSync(statePath, "utf8")) as FixtureState;
  } catch {
    return { repositorySecrets: [] };
  }
}

if (fixturePath) {
  const fixture = JSON.parse(
    readFileSync(fixturePath, "utf8"),
  ) as FixtureDocument;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (LOOPBACK.has(url.hostname)) return originalFetch(input, init);
    if (url.origin === GITHUB_API) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const response = answerGitHub(fixture, method, url, headers);
      record(method, url, response ? "github_fixture" : "github_unhandled");
      return response ?? json(404, { message: "Not Found" });
    }
    record(
      method,
      url,
      method === "GET" && url.href === NEXT_DEVELOPMENT_VERSION_PROBE
        ? "development_probe_blocked"
        : "blocked",
    );
    throw new TypeError("fetch failed: external network is closed");
  };
}

function answerGitHub(
  fixture: FixtureDocument,
  method: string,
  url: URL,
  headers: Headers,
): Response | null {
  // Octokit encodes slashes inside path parameters such as `heads/<branch>`.
  const path = safeDecode(url.pathname);
  const firstPage = (url.searchParams.get("page") ?? "1") === "1";
  let match = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path);
  if (match && method === "POST") {
    if (!fixture.installations.some((item) => item.id === match![1]))
      return json(404, { message: "Not Found" });
    return json(201, {
      token: `rr-visual-installation-token-${match[1]}`,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      permissions: {
        actions: "write",
        administration: "read",
        contents: "write",
        metadata: "read",
        pull_requests: "write",
        secrets: "write",
        workflows: "write",
      },
      repository_selection: "selected",
    });
  }
  if (method !== "GET") return null;

  match =
    /^\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/.exec(
      path,
    );
  if (match) {
    const repository = findRepository(fixture, match[1]!, match[2]!);
    const login = match[3]!;
    const user = fixture.users.find(
      (item) => item.login.toLowerCase() === login.toLowerCase(),
    );
    const permission = repository?.permissions[user?.login ?? ""] ?? "none";
    if (!repository || !user || permission === "none")
      return json(404, { message: "Not Found" });
    // GitHub folds maintain and triage into write and read, keeping the role.
    return json(200, {
      permission:
        permission === "maintain"
          ? "write"
          : permission === "triage"
            ? "read"
            : permission,
      role_name: permission,
      user: { id: Number(user.id), login: user.login },
    });
  }

  match = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path);
  if (match) {
    const repository = findRepository(fixture, match[1]!, match[2]!);
    return repository
      ? json(200, {
          id: Number(repository.id),
          name: repository.name,
          full_name: `${repository.owner}/${repository.name}`,
          owner: { login: repository.owner },
          private: true,
          visibility: "private",
          archived: false,
          default_branch: "main",
        })
      : json(404, { message: "Not Found" });
  }

  match = /^\/orgs\/([^/]+)$/.exec(path);
  if (match) {
    const org = match[1]!;
    return fixture.organizations.includes(org)
      ? json(200, { login: org, plan: { name: "team" } })
      : json(404, { message: "Not Found" });
  }

  if (path === "/user/installations") {
    const login = userLogin(headers);
    const installations = fixture.installations.filter(
      (installation) =>
        visibleRepositories(fixture, installation.id, login).length > 0,
    );
    return json(200, {
      total_count: installations.length,
      installations: firstPage
        ? installations.map((item) => ({
            id: Number(item.id),
            account: { login: item.accountLogin },
          }))
        : [],
    });
  }

  match = /^\/user\/installations\/(\d+)\/repositories$/.exec(path);
  if (match) {
    const repositories = visibleRepositories(
      fixture,
      match[1]!,
      userLogin(headers),
    );
    return json(200, {
      total_count: repositories.length,
      repositories: firstPage
        ? repositories.map(({ repository, permission }) => ({
            id: Number(repository.id),
            name: repository.name,
            full_name: `${repository.owner}/${repository.name}`,
            permissions: repositoryPermissions(permission),
          }))
        : [],
    });
  }

  match = /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/.exec(path);
  if (match) {
    const pullRequest = findPullRequest(fixture, match[1]!, match[2]!);
    return pullRequest && pullRequest.number === Number(match[3])
      ? json(200, {
          number: pullRequest.number,
          state: "open",
          merged: false,
          head: { ref: pullRequest.headRef, sha: pullRequest.headSha },
          base: { ref: pullRequest.baseRef },
        })
      : json(404, { message: "Not Found" });
  }

  // Secret metadata only; GitHub never returns a secret value.
  match = /^\/repos\/([^/]+)\/([^/]+)\/actions\/secrets\/([A-Za-z0-9_]+)$/.exec(
    path,
  );
  if (match && match[3] !== "public-key") {
    const key = `${match[1]}/${match[2]}/${match[3]}`.toLowerCase();
    return readState().repositorySecrets.includes(key)
      ? json(200, {
          name: match[3],
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
        })
      : json(404, { message: "Not Found" });
  }
  // The fixture organizations keep no organization secrets.
  if (/^\/orgs\/[^/]+\/actions\/secrets\/[^/]+(\/repositories)?$/.test(path))
    return json(404, { message: "Not Found" });

  // Fixture repositories have no files: no workflow is installed yet.
  if (/^\/repos\/[^/]+\/[^/]+\/contents\/.+$/.test(path))
    return json(404, { message: "Not Found" });

  match = /^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/.exec(path);
  if (match) {
    const pullRequest = findPullRequest(fixture, match[1]!, match[2]!);
    const branch = match[3]!;
    return pullRequest && pullRequest.headRef === branch
      ? json(200, {
          ref: `refs/heads/${branch}`,
          object: { sha: pullRequest.headSha, type: "commit" },
        })
      : json(404, { message: "Not Found" });
  }
  return null;
}

function findRepository(fixture: FixtureDocument, owner: string, name: string) {
  return fixture.repositories.find(
    (item) =>
      item.owner.toLowerCase() === owner.toLowerCase() &&
      item.name.toLowerCase() === name.toLowerCase(),
  );
}

function findPullRequest(
  fixture: FixtureDocument,
  owner: string,
  name: string,
) {
  return fixture.pullRequests.find(
    (item) =>
      item.owner.toLowerCase() === owner.toLowerCase() &&
      item.name.toLowerCase() === name.toLowerCase(),
  );
}

function visibleRepositories(
  fixture: FixtureDocument,
  installationId: string,
  login: string,
) {
  return fixture.repositories
    .filter((repository) => repository.installationId === installationId)
    .map((repository) => ({
      repository,
      permission: repository.permissions[login] ?? "none",
    }))
    .filter((item) => item.permission !== "none");
}

/** The user of a fixture user token; the seed stores one per user. */
function userLogin(headers: Headers): string {
  const token = (headers.get("authorization") ?? "").replace(
    /^(?:Bearer|token)\s+/i,
    "",
  );
  return token.startsWith(USER_TOKEN_PREFIX)
    ? token.slice(USER_TOKEN_PREFIX.length)
    : "";
}

function repositoryPermissions(permission: Permission) {
  const rank = ["none", "read", "triage", "write", "maintain", "admin"];
  const level = rank.indexOf(permission);
  return {
    admin: level >= 5,
    maintain: level >= 4,
    push: level >= 3,
    triage: level >= 2,
    pull: level >= 1,
  };
}

function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Method, origin and path only: never headers, query values or bodies. */
function record(method: string, url: URL, outcome: string): void {
  if (!networkLog) return;
  appendFileSync(
    networkLog,
    `${JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      method,
      origin: url.origin,
      path: url.pathname,
      outcome,
    })}\n`,
    { mode: 0o600 },
  );
}
