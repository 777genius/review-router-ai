import { generateKeyPairSync } from "node:crypto";
import { App } from "@octokit/app";
import { Octokit } from "@octokit/rest";
import { describe, expect, it } from "vitest";
import {
  SdkGrowthCheckGateway,
  type SdkGrowthGitHubRequestPort,
} from "./sdk-growth-check-gateway";

const spec = {
  repositoryId: "101",
  installationId: "202",
  appId: "303",
  repositoryFullName: "owner/repo",
  headSha: "a".repeat(40),
  name: "ReviewRouter / SDK growth authority",
  externalId: `rr-sdk-growth-v1:${"b".repeat(64)}`,
  conclusion: "success",
  output: { title: "Authority admitted", summary: "Exact receipt." },
} as const;

class FakeGitHub implements SdkGrowthGitHubRequestPort {
  readonly authCalls: Array<Readonly<{ type: "installation" }>> = [];
  readonly calls: Array<{
    route: string;
    parameters: Readonly<Record<string, unknown>>;
  }> = [];
  pages = new Map<number, unknown>();
  authentication: unknown = {
    type: "token",
    tokenType: "installation",
    token: "fixture-installation-token",
    installationId: 202,
    repositorySelection: "selected",
    permissions: { checks: "write" },
    createdAt: "2026-09-19T00:00:00.000Z",
    expiresAt: "2026-09-19T01:00:00.000Z",
  };
  installation: unknown = { id: 202, app_id: 303, suspended_at: null };
  app: unknown = { id: 303, slug: "reviewrouter" };
  installationRepositories: unknown = {
    total_count: 1,
    repositories: [
      {
        id: 101,
        node_id: "R_kgDOExample",
        name: "repo",
        full_name: "owner/repo",
        private: true,
        owner: { login: "owner", id: 404 },
      },
    ],
  };
  post: unknown = { id: 909 };
  postError: unknown = null;

  async auth(options: Readonly<{ type: "installation" }>) {
    this.authCalls.push(options);
    return this.authentication;
  }

  async request(route: string, parameters: Readonly<Record<string, unknown>>) {
    this.calls.push({ route, parameters });
    if (route === "GET /repos/{owner}/{repo}/installation")
      return { data: this.installation };
    if (route === "GET /app") return { data: this.app };
    if (route === "GET /installation/repositories") {
      return { data: this.installationRepositories };
    }
    if (route === "GET /repos/{owner}/{repo}/commits/{ref}/check-runs") {
      const page = Number(parameters.page);
      if (!this.pages.has(page)) {
        return { data: { total_count: 0, check_runs: [] } };
      }
      return { data: this.pages.get(page) };
    }
    if (route === "POST /repos/{owner}/{repo}/check-runs") {
      if (this.postError) throw this.postError;
      return { data: this.post };
    }
    throw new Error(`unexpected_route:${route}`);
  }
}

describe("SdkGrowthCheckGateway", () => {
  it("uses real Octokit installation authentication and provider response fields", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fixture = new FakeGitHub();
    const requests: Array<{
      path: string;
      authorization: string;
      signal: unknown;
    }> = [];
    const app = new App({
      appId: 303,
      privateKey: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      Octokit: Octokit.defaults({
        request: {
          fetch: async (url: string, options: RequestInit) => {
            const path = new URL(url).pathname;
            const authorization =
              new Headers(options.headers).get("authorization") ?? "";
            requests.push({ path, authorization, signal: options.signal });
            let data: unknown;
            if (path === "/app/installations/202/access_tokens") {
              data = {
                token: "fixture-installation-token",
                expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                permissions: { checks: "write", metadata: "read" },
                repository_selection: "selected",
              };
            } else if (path === "/app") data = fixture.app;
            else if (path === "/repos/owner/repo/installation")
              data = fixture.installation;
            else if (path === "/installation/repositories")
              data = fixture.installationRepositories;
            else if (path.endsWith("/check-runs"))
              data = { total_count: 1, check_runs: [check()] };
            else throw new Error("unexpected fixture route");
            return new Response(JSON.stringify(data), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      }),
    });
    const client = await app.getInstallationOctokit(202);
    await expect(
      new SdkGrowthCheckGateway(client, spec).inspect(spec, signal()),
    ).resolves.toMatchObject({ kind: "exact", checkRunId: "909" });
    for (const request of requests.filter(
      ({ path }) =>
        path === "/installation/repositories" || path.endsWith("/check-runs"),
    )) {
      expect(request.authorization).toBe("token fixture-installation-token");
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    { id: 999, app_id: 303, suspended_at: null },
    { id: 202, app_id: 999, suspended_at: null },
    { id: 202, app_id: 303, suspended_at: "2026-09-19T00:00:00Z" },
  ])(
    "rejects installation ownership or suspension mismatch",
    async (installation) => {
      const github = new FakeGitHub();
      github.installation = installation;
      await expect(
        gateway(github).create(spec, "attempt-1", signal()),
      ).resolves.toMatchObject({
        kind: "no-effect",
        reason: "local-pre-dispatch",
      });
      expect(github.calls.some(({ route }) => route.startsWith("POST "))).toBe(
        false,
      );
    },
  );

  it.each([
    {
      type: "token",
      tokenType: "oauth",
      installationId: 202,
      permissions: { checks: "write" },
    },
    {
      type: "token",
      tokenType: "installation",
      installationId: 999,
      permissions: { checks: "write" },
    },
    {
      type: "token",
      tokenType: "installation",
      installationId: 202,
      permissions: { checks: "read" },
    },
  ])(
    "rejects credentials that do not authorize the selected installation",
    async (authentication) => {
      const github = new FakeGitHub();
      github.authentication = authentication;
      await expect(
        gateway(github).create(spec, "attempt-1", signal()),
      ).resolves.toMatchObject({ kind: "no-effect" });
      expect(github.calls).toHaveLength(0);
    },
  );

  it("bounds stalled provider reads and forbids dispatch after cancellation", async () => {
    const github = new FakeGitHub();
    github.request = () => new Promise<never>(() => undefined);
    await expect(
      gateway(github, 10).inspect(spec, signal()),
    ).resolves.toMatchObject({ kind: "unknown", reason: "transport" });

    const cancelled = new FakeGitHub();
    const controller = new AbortController();
    const original = cancelled.request.bind(cancelled);
    cancelled.request = async (route, parameters) => {
      const response = await original(route, parameters);
      controller.abort();
      return response;
    };
    await expect(
      gateway(cancelled).create(spec, "attempt-1", controller.signal),
    ).resolves.toMatchObject({ kind: "unknown" });
    expect(cancelled.calls).toHaveLength(1);
    expect(cancelled.calls[0]?.parameters.request).toMatchObject({
      retries: 0,
    });
  });

  it.each([
    ["9007199254740992", "202", "101"],
    ["303", "9007199254740992", "101"],
    ["303", "202", "9007199254740992"],
    ["01", "202", "101"],
  ])(
    "rejects unsafe numeric identities",
    (appId, installationId, repositoryId) => {
      expect(
        () =>
          new SdkGrowthCheckGateway(new FakeGitHub(), {
            appId,
            installationId,
            repositoryId,
            repositoryFullName: "owner/repo",
          }),
      ).toThrow();
    },
  );

  it("accepts one exact result on a later page and requests filter=all", async () => {
    const github = new FakeGitHub();
    github.pages.set(1, {
      total_count: 101,
      check_runs: Array.from({ length: 100 }, (_, index) =>
        check({
          id: index + 1,
          externalId: `unrelated:${index}`,
        }),
      ),
    });
    github.pages.set(2, {
      total_count: 101,
      check_runs: [check({ id: 909 })],
    });

    await expect(
      gateway(github).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "exact",
      checkRunId: "909",
    });
    const listCalls = github.calls.filter((call) =>
      call.route.includes("commits/{ref}/check-runs"),
    );
    expect(listCalls).toHaveLength(2);
    expect(listCalls[0]?.parameters).toMatchObject({
      filter: "all",
      per_page: 100,
      page: 1,
      ref: spec.headSha,
    });
    expect(listCalls[0]?.parameters).not.toHaveProperty("signal");
    expect(listCalls[0]?.parameters.request).toMatchObject({
      signal: expect.any(AbortSignal),
    });
  });

  it("reports a duplicate introduced on a later page", async () => {
    const github = new FakeGitHub();
    github.pages.set(1, {
      total_count: 101,
      check_runs: [
        check({ id: 909 }),
        ...Array.from({ length: 99 }, (_, index) =>
          check({
            id: index + 1,
            externalId: `unrelated:${index}`,
          }),
        ),
      ],
    });
    github.pages.set(2, {
      total_count: 101,
      check_runs: [check({ id: 910 })],
    });

    await expect(
      gateway(github).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "conflict",
      reason: "duplicate",
      witnessIds: ["909", "910"],
    });
  });

  it("does not count a repeated provider row as complete pagination", async () => {
    const github = new FakeGitHub();
    github.pages.set(1, {
      total_count: 101,
      check_runs: Array.from({ length: 100 }, (_, index) =>
        check({
          id: index + 1,
          externalId: `unrelated:${index}`,
        }),
      ),
    });
    github.pages.set(2, {
      total_count: 101,
      check_runs: [check({ id: 1, externalId: "unrelated:0" })],
    });

    await expect(
      gateway(github).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "partial-read",
    });
  });

  it("rejects the wrong numeric App even when slug and name match", async () => {
    const github = new FakeGitHub();
    github.pages.set(1, {
      total_count: 1,
      check_runs: [check({ appId: 404 })],
    });

    await expect(
      gateway(github).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "conflict",
      reason: "identity-mismatch",
    });
  });

  it.each([
    ["sha", { headSha: "c".repeat(40) }],
    ["name", { name: "ReviewRouter / other" }],
    ["external id", { externalId: `rr-sdk-growth-v1:${"c".repeat(64)}` }],
    ["conclusion", { conclusion: "failure" }],
    ["output", { summary: "wrong" }],
  ])(
    "rejects wrong %s under the intended correlation",
    async (_label, changes) => {
      const github = new FakeGitHub();
      github.pages.set(1, {
        total_count: 1,
        check_runs: [check(changes)],
      });

      await expect(
        gateway(github).inspect(spec, signal()),
      ).resolves.toMatchObject(
        _label === "external id" ? { kind: "absent" } : { kind: "conflict" },
      );
    },
  );

  it("derives repository and installation identity from the authenticated client", async () => {
    const wrongInstallation = new FakeGitHub();
    wrongInstallation.authentication = {
      type: "token",
      tokenType: "installation",
      installationId: 999,
    };
    await expect(
      gateway(wrongInstallation).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "local-pre-dispatch",
    });
    expect(
      wrongInstallation.calls.some((call) => call.route.startsWith("POST ")),
    ).toBe(false);

    const wrongRepository = new FakeGitHub();
    wrongRepository.installationRepositories = {
      total_count: 1,
      repositories: [{ id: 999, full_name: "owner/repo" }],
    };
    await expect(
      gateway(wrongRepository).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "local-pre-dispatch",
    });
    expect(
      wrongRepository.calls.some((call) => call.route.startsWith("POST ")),
    ).toBe(false);

    const readOnlyCredentials = new FakeGitHub();
    readOnlyCredentials.authentication = {
      type: "token",
      tokenType: "installation",
      installationId: 202,
      permissions: { checks: "read" },
    };
    await expect(
      gateway(readOnlyCredentials).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "local-pre-dispatch",
    });
    expect(
      readOnlyCredentials.calls.some((call) => call.route.startsWith("POST ")),
    ).toBe(false);
    expect(wrongInstallation.authCalls).toEqual([{ type: "installation" }]);
  });

  it("uses the installed Octokit App installation authentication strategy", async () => {
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    const providerCalls: Array<{
      path: string;
      method: string;
      authorization: string | null;
      signal: AbortSignal | null;
    }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      const path = new URL(url).pathname;
      const headers = new Headers(init?.headers);
      providerCalls.push({
        path,
        method: init?.method ?? "GET",
        authorization: headers.get("authorization"),
        signal: init?.signal ?? null,
      });
      if (path === "/app/installations/202/access_tokens") {
        return Response.json({
          token: "test-installation-token",
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          permissions: { checks: "write" },
          repository_selection: "selected",
          repositories: [{ id: 101, name: "repo" }],
        });
      }
      if (path === "/app") return Response.json({ id: 303 });
      if (path === "/repos/owner/repo/installation")
        return Response.json({ id: 202, app_id: 303, suspended_at: null });
      if (path === "/installation/repositories") {
        return Response.json({
          total_count: 1,
          repositories: [{ id: 101, full_name: "owner/repo" }],
        });
      }
      if (path === "/repos/owner/repo/check-runs") {
        return Response.json({ id: 909 });
      }
      throw new Error(`unexpected_provider_path:${path}`);
    };

    try {
      const app = new App({ appId: 303, privateKey });
      const client = await app.getInstallationOctokit(202);
      const actual = new SdkGrowthCheckGateway(client, {
        appId: spec.appId,
        installationId: spec.installationId,
        repositoryId: spec.repositoryId,
        repositoryFullName: spec.repositoryFullName,
      });

      await expect(
        actual.create(spec, "attempt-actual-octokit", signal()),
      ).resolves.toEqual({ kind: "acknowledged", checkRunId: "909" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(providerCalls.map((call) => call.path)).toEqual([
      "/app/installations/202/access_tokens",
      "/app",
      "/repos/owner/repo/installation",
      "/installation/repositories",
      "/repos/owner/repo/check-runs",
    ]);
    expect(providerCalls.slice(1).every((call) => call.signal)).toBe(true);
    expect(providerCalls.slice(2).every((call) => call.authorization)).toBe(
      true,
    );
  });

  it.each([401, 201])(
    "dispatches exactly once when a fresh installation token receives 401 then %s",
    async (replayStatus) => {
      const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      const fixture = new FakeGitHub();
      const posts: RequestInit[] = [];
      let tokenRequests = 0;
      const app = new App({
        appId: 303,
        privateKey,
        Octokit: Octokit.defaults({
          request: {
            fetch: async (url: string, options: RequestInit) => {
              const path = new URL(url).pathname;
              if (path === "/app/installations/202/access_tokens") {
                tokenRequests += 1;
                return Response.json({
                  token: "fresh-installation-token",
                  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                  permissions: { checks: "write" },
                  repository_selection: "selected",
                });
              }
              if (path === "/app") return Response.json(fixture.app);
              if (path === "/repos/owner/repo/installation")
                return Response.json(fixture.installation);
              if (path === "/installation/repositories")
                return Response.json(fixture.installationRepositories);
              if (path === "/repos/owner/repo/check-runs") {
                posts.push(options);
                const status = posts.length === 1 ? 401 : replayStatus;
                return Response.json(
                  status === 401 ? { message: "Bad credentials" } : { id: 909 },
                  { status },
                );
              }
              throw new Error(`unexpected_provider_path:${path}`);
            },
          },
        }),
      });
      const client = await app.getInstallationOctokit(202);
      const result = await new SdkGrowthCheckGateway(client, spec).create(
        spec,
        "fresh-token-attempt",
        signal(),
      );
      expect(posts).toHaveLength(1);
      expect(tokenRequests).toBe(1);
      expect(posts[0]?.method).toBe("POST");
      expect(new Headers(posts[0]?.headers).get("authorization")).toBe(
        "token fresh-installation-token",
      );
      expect(posts[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(result).toMatchObject({
        kind: "no-effect",
        reason: "provider-rejected",
      });
    },
    15_000,
  );

  it("treats incomplete provider output as malformed instead of exact", async () => {
    for (const missing of [
      "title",
      "summary",
      "text",
      "annotations_count",
    ] as const) {
      const github = new FakeGitHub();
      const row = check();
      Reflect.deleteProperty(row.output, missing);
      github.pages.set(1, { total_count: 1, check_runs: [row] });

      await expect(
        gateway(github).inspect(spec, signal()),
      ).resolves.toMatchObject({
        kind: "unknown",
        reason: "malformed-response",
      });
    }
  });

  it("returns unknown for incomplete and malformed pagination", async () => {
    const incomplete = new FakeGitHub();
    incomplete.pages.set(1, {
      total_count: 101,
      check_runs: Array.from({ length: 100 }, (_, index) =>
        check({ id: index + 1, externalId: `other:${index}` }),
      ),
    });
    incomplete.pages.set(2, {
      total_count: 101,
      check_runs: [],
    });
    await expect(
      gateway(incomplete).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "partial-read",
    });

    const malformed = new FakeGitHub();
    malformed.pages.set(1, { total_count: "one", check_runs: [] });
    await expect(
      gateway(malformed).inspect(spec, signal()),
    ).resolves.toMatchObject({
      kind: "unknown",
      reason: "malformed-response",
    });
  });

  it("disables POST retries and leaves acknowledgement subject to readback", async () => {
    const github = new FakeGitHub();

    await expect(
      gateway(github).create(spec, "attempt-1", signal()),
    ).resolves.toEqual({ kind: "acknowledged", checkRunId: "909" });
    const post = github.calls.find((call) => call.route.startsWith("POST "));
    expect(post?.parameters).toMatchObject({
      external_id: spec.externalId,
      status: "completed",
      headers: { authorization: "token fixture-installation-token" },
      request: { retries: 0, signal: expect.any(AbortSignal), hook: null },
    });
    expect(post?.parameters).not.toHaveProperty("hook");
    expect(post?.parameters).not.toHaveProperty("signal");
  });

  it("rejects missing installation tokens before the hook-free POST", async () => {
    const github = new FakeGitHub();
    Reflect.deleteProperty(
      github.authentication as Record<string, unknown>,
      "token",
    );
    await expect(
      gateway(github).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "local-pre-dispatch",
    });
    expect(github.calls.some(({ route }) => route.startsWith("POST "))).toBe(
      false,
    );
  });

  it("classifies timeout and ambiguous POST failures as unknown", async () => {
    for (const error of [
      { status: 408 },
      { status: 418 },
      { status: 499 },
      { status: 500 },
      new Error("reset"),
    ]) {
      const github = new FakeGitHub();
      github.postError = error;
      await expect(
        gateway(github).create(spec, "attempt-1", signal()),
      ).resolves.toMatchObject({ kind: "unknown", reason: "transport" });
    }
  });

  it("uses no-effect only for an authenticated definite provider rejection", async () => {
    const github = new FakeGitHub();
    github.postError = { status: 422 };

    await expect(
      gateway(github).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "provider-rejected",
    });
  });

  it("bounds a stalled POST as unknown without resending", async () => {
    const github = new FakeGitHub();
    const original = github.request.bind(github);
    let posts = 0;
    github.request = (route, parameters) => {
      if (route.startsWith("POST ")) {
        posts += 1;
        return new Promise<never>(() => undefined);
      }
      return original(route, parameters);
    };
    await expect(
      gateway(github, 50).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({ kind: "unknown", reason: "transport" });
    expect(posts).toBe(1);
  });

  it("rejects cancellation before dispatch and bounds stalled authentication", async () => {
    const cancelled = new FakeGitHub();
    const controller = new AbortController();
    controller.abort();
    await expect(
      gateway(cancelled).create(spec, "attempt-1", controller.signal),
    ).resolves.toMatchObject({ kind: "unknown", reason: "transport" });
    expect(cancelled.calls).toHaveLength(0);

    const stalled = new FakeGitHub();
    stalled.auth = () => new Promise<never>(() => undefined);
    await expect(
      gateway(stalled, 10).inspect(spec, signal()),
    ).resolves.toMatchObject({ kind: "unknown", reason: "transport" });
    expect(stalled.calls).toHaveLength(0);
  });

  it("rejects mismatched configured repository and installation before publication", async () => {
    const github = new FakeGitHub();
    github.installationRepositories = {
      total_count: 1,
      repositories: [{ id: 999, full_name: "owner/repo" }],
    };

    await expect(
      gateway(github).create(spec, "attempt-1", signal()),
    ).resolves.toMatchObject({
      kind: "no-effect",
      reason: "local-pre-dispatch",
    });
    expect(github.calls.some((call) => call.route.startsWith("POST "))).toBe(
      false,
    );
  });
});

function gateway(github: FakeGitHub, deadlineMs = 15_000) {
  return new SdkGrowthCheckGateway(
    github,
    {
      appId: spec.appId,
      installationId: spec.installationId,
      repositoryId: spec.repositoryId,
      repositoryFullName: spec.repositoryFullName,
    },
    () => 1_700_000_000_000,
    deadlineMs,
  );
}

function check(
  input: Readonly<{
    id?: number;
    appId?: number;
    headSha?: string;
    name?: string;
    externalId?: string;
    conclusion?: string;
    title?: string;
    summary?: string;
  }> = {},
) {
  return {
    id: input.id ?? 909,
    node_id: "CR_kwDOExample",
    url: "https://api.github.test/repos/owner/repo/check-runs/909",
    html_url: "https://github.test/owner/repo/runs/909",
    details_url: "https://reviewrouter.test/authority/intent-1",
    app: { id: input.appId ?? 303, slug: "matching-slug" },
    head_sha: input.headSha ?? spec.headSha,
    name: input.name ?? spec.name,
    external_id: input.externalId ?? spec.externalId,
    status: "completed",
    conclusion: input.conclusion ?? spec.conclusion,
    started_at: "2026-09-19T00:00:00Z",
    completed_at: "2026-09-19T00:00:01Z",
    output: {
      title: input.title ?? spec.output.title,
      summary: input.summary ?? spec.output.summary,
      text: null,
      annotations_count: 0,
      annotations_url:
        "https://api.github.test/repos/owner/repo/check-runs/909/annotations",
    },
    check_suite: { id: 808, head_sha: input.headSha ?? spec.headSha },
    pull_requests: [],
  };
}

function signal() {
  return new AbortController().signal;
}
