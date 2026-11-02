import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCodexRotatingGitHubAction } from "../action/github-action";

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  statfs: vi.fn(async () => ({ bavail: 5 * 1024 * 1024, bsize: 1024 })),
}));

describe("Hosted original grant bootstrap for the common OCR parent", () => {
  const temporaryDirectories: string[] = [];
  afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function fixture(
    options: {
      reviewRequestId?: string | null;
      repository?: string;
      grantStatus?: number;
    } = {},
  ) {
    const directory = await mkdtemp(join(tmpdir(), "rr-hosted-parent-"));
    temporaryDirectories.push(directory);
    const workspace = join(directory, "workspace");
    const eventPath = join(directory, "event.json");
    await mkdir(workspace);
    await writeFile(
      eventPath,
      JSON.stringify({
        number: 12,
        repository: { id: 777, full_name: "acme/review-fixture" },
        pull_request: {
          head: {
            sha: "a".repeat(40),
            repo: { full_name: "acme/review-fixture" },
          },
          base: { sha: "b".repeat(40) },
        },
      }),
    );
    const calls: string[] = [];
    const requestBodies: string[] = [];
    const fetchImpl = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        calls.push(href);
        if (typeof init?.body === "string") requestBodies.push(init.body);
        if (
          href.startsWith(
            "https://vstoken.actions.githubusercontent.com/oidc/token",
          )
        ) {
          return Response.json({ value: "synthetic-fresh-oidc" });
        }
        if (href.endsWith("/api/action/v1/hosted-relay/grant")) {
          if (options.grantStatus)
            return new Response("", { status: options.grantStatus });
          return Response.json({
            protocolVersion: 1,
            grant: "synthetic-original-hosted-grant",
            relayUrl:
              "https://reviewrouter.test/api/action/v1/hosted-codex/responses",
            invocationLeaseId: "original-grant-id",
            runtimeConfigVersion: 3,
            runtimeEnv: {
              REVIEW_AUTH_MODE: "codex-oauth-hosted-pool",
              REVIEW_PROVIDERS: "codex/gpt-5.5",
              ...(options.reviewRequestId === null
                ? {}
                : {
                    REVIEW_REQUEST_ID:
                      options.reviewRequestId ?? "original-review-request",
                  }),
            },
            repository: options.repository ?? "acme/review-fixture",
            commentToken: "synthetic-unused-comment-token",
            commentTokenRefreshCapability:
              "synthetic-unused-refresh-capability",
            grantExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            policy: { maxRequests: 16 },
          });
        }
        throw new Error(`unexpected_legacy_or_paid_fetch:${href}`);
      },
    ) as typeof fetch;
    const env: NodeJS.ProcessEnv = {
      INPUT_MODE: "fork-agentic-sandbox-hosted-pool",
      INPUT_API_URL: "https://reviewrouter.test",
      INPUT_PROVIDER_INSTANCE_ID: "hosted-pool:repository:777",
      INPUT_WORKFLOW_SCHEMA_VERSION: "5",
      INPUT_SESSION_BINDING_ID: "original-binding",
      INPUT_SESSION_BINDING_VERSION: "2",
      REVIEWROUTER_ACTION_V2_MODE: "t0",
      ACTIONS_ID_TOKEN_REQUEST_URL:
        "https://vstoken.actions.githubusercontent.com/oidc/token",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "synthetic-oidc-request-token",
      GITHUB_ACTION_PATH: directory,
      GITHUB_WORKSPACE: workspace,
      GITHUB_REPOSITORY: "acme/review-fixture",
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_RUN_ID: "9100",
      GITHUB_RUN_ATTEMPT: "1",
      RUNNER_OS: "Linux",
      RUNNER_ARCH: "X64",
      ImageOS: "ubuntu24",
      ImageVersion: "20261026.1",
      PATH: process.env.PATH ?? "",
      INPUT_AUTH_JSON: "synthetic-auth-must-not-be-read",
      REVIEWROUTER_CODEX_AUTH_JSON: "synthetic-auth-must-not-be-read",
      GITHUB_TOKEN: "synthetic-unused-scm-write-token",
      CODEX_HOME: "unused-legacy-home",
      CODEX_CONFIG_TOML: "unused-legacy-auth-config",
      REVIEW_AUTH_MODE: "untrusted-legacy-mode",
      REVIEW_REQUEST_ID: "untrusted-inherited-request",
      REVIEWROUTER_COMMENT_TOKEN_LEASE_ID: "unused-legacy-lease",
    };
    return {
      directory,
      workspace,
      env,
      fetchImpl,
      calls,
      requestBodies,
      io: { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } },
    };
  }

  it("spawns the trusted prepared parent without a Codex bundle, PR checkout, or legacy review effects", async () => {
    const f = await fixture();
    const capturePath = join(f.directory, "parent-result.txt");
    f.env.RR_PARENT_CAPTURE_PATH = capturePath;
    await mkdir(join(f.directory, "dist"));
    await writeFile(
      join(f.directory, "dist", "index.js"),
      `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const env = process.env;
      assert.equal(env.INPUT_MODE, 'prepared-subscription');
      assert.equal(env.REVIEW_ROUTER_MODE, 'prepared-subscription');
      assert.equal(env.REVIEWROUTER_ACTION_V2_MODE, 't0');
      assert.equal(env.REVIEWROUTER_PREPARED_MODEL_TRANSPORT, 'hosted_pool');
      assert.equal(env.REVIEWROUTER_HOSTED_ORIGINAL_GRANT, 'synthetic-original-hosted-grant');
      assert.equal(env.REVIEW_REQUEST_ID, 'original-review-request');
      assert.equal(env.REVIEWROUTER_RUNTIME_CONFIG_MODE, 'oidc');
      assert.equal(env.REVIEWROUTER_STATIC_CONFIG_FALLBACK, 'false');
      assert.equal(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'synthetic-oidc-request-token');
      assert.equal(env.GITHUB_WORKSPACE, process.cwd());
      assert.equal(env.REVIEW_HEAD_SHA, 'a'.repeat(40));
      for (const name of ['INPUT_AUTH_JSON', 'REVIEWROUTER_CODEX_AUTH_JSON',
        'GITHUB_TOKEN', 'CODEX_HOME', 'CODEX_CONFIG_TOML', 'REVIEW_AUTH_MODE',
        'REVIEWROUTER_COMMENT_TOKEN_LEASE_ID', 'REVIEW_ROUTER_PR_WORKSPACE']) {
        assert.equal(env[name], undefined, name);
      }
      fs.writeFileSync(env.RR_PARENT_CAPTURE_PATH, 'prepared-parent-completed');
    `,
    );
    const signalHandlers = process.listenerCount("SIGTERM");
    await runCodexRotatingGitHubAction(f);
    expect(await readFile(capturePath, "utf8")).toBe(
      "prepared-parent-completed",
    );
    expect(f.calls).toHaveLength(2);
    expect(JSON.parse(f.requestBodies[0]!)).toMatchObject({
      providerInstanceId: "hosted-pool:repository:777",
      bindingId: "original-binding",
      bindingVersion: 2,
      workflowSchemaVersion: 5,
    });
    expect(f.requestBodies.join("\n")).not.toContain(
      "synthetic-original-hosted-grant",
    );
    expect(existsSync(join(f.workspace, ".reviewrouter-codex-home"))).toBe(
      false,
    );
    expect(existsSync(join(f.workspace, ".reviewrouter-pr"))).toBe(false);
    expect(f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
    expect(f.env.INPUT_AUTH_JSON).toBeUndefined();
    expect(process.listenerCount("SIGTERM")).toBe(signalHandlers);
  });

  it("does not reissue a grant or enter legacy account failover after a parent failure", async () => {
    const f = await fixture();
    const fullReviewRuntimeRunner = vi.fn(async (input) => {
      expect(input.kind).toBe("prepared-subscription");
      expect(input.originalGrant).toBe("synthetic-original-hosted-grant");
      expect(input.reviewRequestId).toBe("original-review-request");
      expect(input).not.toHaveProperty("codexBinaryPath");
      expect(input).not.toHaveProperty("commentToken");
      expect(input).not.toHaveProperty("runtimeEnv");
      throw new Error("hosted_pool_quota_exhausted");
    });
    await expect(
      runCodexRotatingGitHubAction({ ...f, fullReviewRuntimeRunner }),
    ).rejects.toThrow("hosted_pool_quota_exhausted");
    expect(fullReviewRuntimeRunner).toHaveBeenCalledOnce();
    expect(f.calls).toHaveLength(2);
    expect(f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
  });

  it.each([
    [{ reviewRequestId: null }, "hosted_grant_review_request_missing"],
    [{ reviewRequestId: "bad request" }, "hosted_grant_review_request_missing"],
    [{ repository: "other/repository" }, "hosted_grant_repository_mismatch"],
    [{ grantStatus: 401 }, "hosted_relay_grant_failed:401"],
  ] as const)(
    "fails closed for an unbound grant (%s)",
    async (options, error) => {
      const f = await fixture(options);
      const fullReviewRuntimeRunner = vi.fn();
      await expect(
        runCodexRotatingGitHubAction({ ...f, fullReviewRuntimeRunner }),
      ).rejects.toThrow(error);
      expect(fullReviewRuntimeRunner).not.toHaveBeenCalled();
      expect(f.calls).toHaveLength(2);
      expect(f.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
    },
  );
});
