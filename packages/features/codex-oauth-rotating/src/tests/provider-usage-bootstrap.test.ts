import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createHash, verify } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  canonicalJson,
  validateUsageFact,
  type UsageFact,
} from "@reviewrouter/protocol-review-action-v2";
import {
  UsageDelivery,
  withUsageArtifactUploadTimeout,
  type UsageGrant,
} from "../action/provider-usage-delivery.js";
import { startCodexLocalProviderProxy } from "../action/github-action.js";

const bundledProxy = (
  createRequire(import.meta.url)(
    join(process.cwd(), "action-dist/index.cjs"),
  ) as {
    startCodexLocalProviderProxy: typeof startCodexLocalProviderProxy;
  }
).startCodexLocalProviderProxy;

it.each([
  ["source", startCodexLocalProviderProxy],
  ["bundled Action artifact", bundledProxy],
] as const)(
  "%s records bootstrap Responses failures/retries as signed diagnostic facts",
  async (_name, startProxy) => {
    const directory = await mkdtemp(join(tmpdir(), "TEST-bootstrap-usage-"));
    const registration = UsageDelivery.prepareRegistration();
    const grant: UsageGrant = {
      grantId: "grant",
      grantToken: "PRIVATE-grant",
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      scope: {
        sourceInstance: "bootstrap:lease",
        callIdPrefix: "bootstrap-lease:",
        provider: "codex",
        requestedModel: null,
        runtimeType: "codex-refresh-bootstrap",
        route: "direct",
        purpose: "diagnostic",
        workspaceId: "workspace",
        repositoryId: "123",
        runId: "456",
        runAttempt: 1,
        invocationId: "lease-bootstrap",
        authorizationId: "bootstrap-lease",
        actorId: null,
        bindingId: "provider",
        producerDigest: "release",
        workflowIdentity: "workflow",
        jobIdentity: "job",
      },
    };
    const reported: UsageFact[] = [];
    const delivery = registration.acceptGrant(
      {
        apiUrl: "https://control.test",
        executionToken: "",
        invocationId: grant.scope.invocationId,
        temporaryDirectory: directory,
        uploadArtifact: async () => {},
        fetchImpl: async (_url, init) => {
          const report = JSON.parse(String(init?.body)) as {
            facts: UsageFact[];
          };
          reported.push(...report.facts);
          return new Response(
            JSON.stringify({
              accepted: report.facts.map((fact) => ({
                eventId: fact.eventId,
                revision: fact.revision,
                hash: createHash("sha256")
                  .update(canonicalJson(fact))
                  .digest("hex"),
                status: "accepted",
              })),
            }),
          );
        },
      },
      grant,
    );
    let calls = 0;
    const proxy = await startProxy({
      accessToken: "PRIVATE-access",
      upstreamResponsesUrl: "https://provider.test/responses",
      usageDelivery: delivery,
      fetchImpl: async () =>
        ++calls === 1
          ? new Response("PRIVATE-error", { status: 429 })
          : new Response(
              'data: {"type":"response.completed","response":{"model":"observed-model","usage":{"input_tokens":15,"output_tokens":5},"output":[{"text":"PRIVATE-output"}]}}\n\n',
              { headers: { "content-type": "text/event-stream" } },
            ),
    });
    try {
      for (const status of [429, 200]) {
        const response = await fetch(proxy.baseUrl + "/responses", {
          method: "POST",
          body: '{"model":"test","input":"PRIVATE-prompt"}',
        });
        expect(response.status).toBe(status);
        await response.text();
      }
      await proxy.close();
      const signed = JSON.parse(
        await readFile(delivery.artifactPath, "utf8"),
      ) as Record<string, unknown>;
      const { signature, ...envelope } = signed;
      expect(
        verify(
          null,
          Buffer.from(canonicalJson(envelope)),
          registration.publicKey,
          Buffer.from(String(signature), "base64"),
        ),
      ).toBe(true);
      expect(JSON.stringify(signed)).not.toContain("PRIVATE");
      await delivery.cleanup();
      expect(reported.map((fact) => fact.state)).toEqual([
        "dispatched",
        "failed",
        "dispatched",
        "completed",
      ]);
      for (const fact of reported) {
        validateUsageFact(fact);
        expect(fact.identity.purpose).toBe("diagnostic");
      }
      expect(reported[0]?.identity.callId).not.toBe(
        reported[2]?.identity.callId,
      );
      expect(reported[3]?.tokens.total).toBe(20);
    } finally {
      await proxy.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it("bounds usage artifact cleanup and restores the supported SDK timeout", async () => {
  vi.useFakeTimers();
  const key = "ACTIONS_ARTIFACT_UPLOAD_TIMEOUT_MS",
    prior = process.env[key];
  delete process.env[key];
  try {
    const pending = withUsageArtifactUploadTimeout(async () => {
      expect(process.env[key]).toBe("30000");
      return await new Promise<never>(() => {});
    });
    const rejected = expect(pending).rejects.toThrow(
      "usage_artifact_cleanup_timeout",
    );
    await vi.advanceTimersByTimeAsync(35000);
    await rejected;
    expect(process.env[key]).toBeUndefined();
    process.env[key] = "5000";
    await withUsageArtifactUploadTimeout(async () => {
      expect(process.env[key]).toBe("5000");
    });
    expect(process.env[key]).toBe("5000");
  } finally {
    if (prior === undefined) delete process.env[key];
    else process.env[key] = prior;
    vi.useRealTimers();
  }
});
