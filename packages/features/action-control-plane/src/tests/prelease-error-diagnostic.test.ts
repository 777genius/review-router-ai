import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { registerActionControlPlaneRoutes } from "../interface/http/register-action-control-plane-routes.js";
import { InMemoryCodexRotatingOAuthRepository } from "../infrastructure/memory/in-memory-codex-rotating-oauth-repository.js";

const canary = "synthetic-private-secret-DO-NOT-LOG";
const body = {
  oidcToken: canary,
  audience: "reviewrouter",
  providerInstanceId: "codex-rotating:123456",
  workflowSchemaVersion: 5,
};
const claims = {
  iss: "https://token.actions.githubusercontent.com",
  aud: "reviewrouter",
  repository: "owner/repository",
  repository_id: "123456",
  repository_visibility: "private",
  event_name: "pull_request",
  run_id: "1",
  run_attempt: "1",
  workflow_ref: canary,
  workflow_sha: "a".repeat(40),
  actor: canary,
  runner_environment: "github-hosted",
  iat: 1,
  nbf: 1,
  exp: 2,
  jti: canary,
};
const invalidResponse = {
  error: {
    code: "invalid_action_request",
    message: "Action control plane request is invalid.",
    retryable: false,
  },
};

async function fixture(
  verify = vi.fn().mockResolvedValue(claims),
  logThrows = false,
) {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      stream: {
        write: (line: string) => {
          lines.push(line);
          if (logThrows) throw new Error(canary);
        },
      },
    },
    disableRequestLogging: true,
  });
  const repositories = {
    findSelectedRepositoryByGithubId: vi.fn().mockResolvedValue(undefined),
  };
  const dependencies = {
    oidcVerifier: { verify },
    repositories,
    codexRotatingOAuth: new InMemoryCodexRotatingOAuthRepository([]),
    codexRotatingWorkflowSourceVerifier: { verifyWorkflowSource: vi.fn() },
    replayNonces: { tryConsumeNonce: vi.fn() },
    clock: { now: () => new Date("2026-05-25T12:00:00Z") },
    sessions: {},
    ledgerKeys: {},
    compatibility: {},
  };
  await registerActionControlPlaneRoutes(
    app,
    dependencies as unknown as Parameters<
      typeof registerActionControlPlaneRoutes
    >[1],
  );
  return { app, lines, verify, repositories };
}

function diagnostic(lines: string[]) {
  const records = lines.map((line) => JSON.parse(line));
  const events = records.filter(
    (record) => record.msg === "Codex OAuth prelease rejected",
  );
  expect(events).toHaveLength(1);
  expect(lines.join("")).not.toContain(canary);
  expect(JSON.stringify(events[0]).length).toBeLessThan(2_000);
  return events[0];
}

describe("prelease HTTP rejection diagnostics", () => {
  it("keeps the rejection response when the actual logger sink fails", async () => {
    const { app, lines } = await fixture(
      vi.fn().mockResolvedValue(claims),
      true,
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: { ...body, workflowSchemaVersion: canary },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(invalidResponse);
      expect(diagnostic(lines).stage).toBe("request_body_validation");
    } finally {
      await app.close();
    }
  });

  it("filters public codes with arbitrary passthrough suffixes", async () => {
    const { app, lines } = await fixture(
      vi.fn().mockRejectedValue(new Error("health_report_" + canary)),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: {
          code: "health_report_" + canary,
          message:
            "Action health report was rejected by ReviewRouter safety checks.",
          retryable: false,
        },
      });
      expect(diagnostic(lines)).toMatchObject({
        stage: "use_case_rejection",
        reason: "unknown",
        issues: [],
      });
    } finally {
      await app.close();
    }
  });

  it("distinguishes strict body rejection without disclosing fields or keys", async () => {
    const { app, lines, verify } = await fixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: { ...body, workflowSchemaVersion: canary, [canary]: canary },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(invalidResponse);
      expect(verify).not.toHaveBeenCalled();
      expect(diagnostic(lines)).toMatchObject({
        stage: "request_body_validation",
        issues: [
          { code: "invalid_type", path: "workflowSchemaVersion" },
          { code: "unrecognized_keys", path: "root" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it("distinguishes nested verified claims and stops before repository reads", async () => {
    const { app, lines, repositories } = await fixture(
      vi.fn().mockResolvedValue({
        ...claims,
        repository_id: canary,
        [canary]: canary,
      }),
    );
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(invalidResponse);
      expect(
        repositories.findSelectedRepositoryByGithubId,
      ).not.toHaveBeenCalled();
      expect(diagnostic(lines)).toMatchObject({
        stage: "verified_claim_validation",
        issues: [
          { code: "invalid_format", path: "repository_id" },
          { code: "unrecognized_keys", path: "root" },
        ],
      });
    } finally {
      await app.close();
    }
  });

  it.each([new Error(canary.repeat(1_000)), canary, null])(
    "bounds unknown backend exceptions and preserves HTTP 400",
    async (error) => {
      const { app, lines } = await fixture(vi.fn().mockRejectedValue(error));
      try {
        const response = await app.inject({
          method: "POST",
          url: "/api/action/v1/codex-oauth/prelease",
          payload: body,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual(invalidResponse);
        expect(diagnostic(lines)).toMatchObject({
          stage: "use_case_rejection",
          reason: "unknown",
          issues: [],
        });
      } finally {
        await app.close();
      }
    },
  );

  it("logs a finite existing public rejection without changing its response", async () => {
    const { app, lines } = await fixture();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: body,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        error: {
          code: "repository_not_registered",
          message: "Repository is not registered in ReviewRouter.",
          retryable: false,
        },
      });
      expect(diagnostic(lines)).toMatchObject({
        stage: "use_case_rejection",
        reason: "repository_not_registered",
        issues: [],
      });
    } finally {
      await app.close();
    }
  });

  it("does not mistake backend Zod errors for verified-claim validation or echo hostile paths", async () => {
    const issues = Array.from({ length: 1_000 }, (_, index) => ({
      code: index === 0 ? "invalid_type" : canary,
      path: index === 0 ? ["aud", canary] : Array(100).fill(canary),
      message: canary,
      expected: canary,
      received: canary,
    }));
    const error = new z.ZodError(issues as unknown as z.ZodError["issues"]);
    const { app, lines } = await fixture(vi.fn().mockRejectedValue(error));
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v1/codex-oauth/prelease",
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(invalidResponse);
      const event = diagnostic(lines);
      expect(event.stage).toBe("use_case_rejection");
      expect(event.issues).toHaveLength(8);
      expect(event.issues[0]).toEqual({
        code: "invalid_type",
        path: "unknown",
      });
      expect(event.issues.slice(1)).toEqual(
        Array(7).fill({ code: "unknown", path: "unknown" }),
      );
    } finally {
      await app.close();
    }
  });
});
