import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import {
  canonicalJson,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBinding,
} from "@reviewrouter/features-review-run-control";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createReviewRunGatewayPreparation } from "./review-run-gateway-preparation";
import { createReviewRunGatewayRelay } from "./review-run-gateway-relay";

const MiB = 1024 * 1024;
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function fixture(outputBytes: number, streamBytes = 0) {
  const deadline = new Date(Date.now() + 120_000).toISOString();
  const limits = {
    requests: 128,
    concurrency: 1,
    requestBytes: 4096,
    outputBytes,
    tokens: 32768,
  };
  const gateway = {
    providerIndex: 0,
    bindingId: "binding-1",
    connectionId: "connection-1",
    bindingRevision: 1,
    policySubject: "binding-1",
    policyRevision: 1,
    permittedAccountRef: "account-1",
    profileRef: "profile-1",
    invocationId: "invocation-1",
    attemptId: "attempt-1",
    operationId: "operation-1",
    limits,
  };
  const identity = {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 1,
    sourceRunId: "run-1",
    sourceRunAttempt: "1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    reviewRevisionHash: "c".repeat(64),
    workflowIdentityHash: "d".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
  };
  const config = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
        agenticContext: true,
        requiredHealthy: true,
        gatewayBindingId: gateway.bindingId,
        gatewayProfileRef: gateway.profileRef,
      },
    ],
    execution: {
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
  });
  const canonical = canonicalJson({
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
    agent: {
      profileRef: "codex-default",
      agentKind: "codex",
      binarySha256: "a".repeat(64),
      packageVersion: "0.147.0",
      modelTransports: ["account_gateway"],
      contextGateway: true,
      cancellation: true,
    },
    agentProfileDigest: "b".repeat(64),
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "c".repeat(40),
      runtimeCommitSha: "d".repeat(40),
    },
    configurationCanonicalJson: canonicalJson(config),
    deadline,
    gateway,
  });
  let active = true;
  const authorization = () =>
    ({
      ...identity,
      authorizationId: "authorization-1",
      state: active
        ? ReviewRunAuthorizationState.Active
        : ReviewRunAuthorizationState.Revoked,
      expiresAt: new Date(deadline),
      maxExpiresAt: new Date(deadline),
      runtimeSnapshotCanonicalJson: canonical,
    }) as ReviewRunAuthorization;
  let binding: ReviewRunGatewayExecutionBinding | null = null;
  const bindings = {
    read: async () => ({ status: "live" as const, binding }),
    attach: async (
      _owner: unknown,
      value: ReviewRunGatewayExecutionBinding,
    ) => {
      binding = value;
      return { status: "attached" as const, binding: value };
    },
  };
  const snapshots = { capture: async () => null, isLive: async () => active };
  const intents: c.Prepare[] = [];
  const admissions: c.Admission[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    if (req.url === "/internal/v1/run-access") {
      const intent = JSON.parse(raw) as c.Prepare;
      intents.push(intent);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          operation: {
            operationRef: intent.operationId,
            state: "applied",
            result: {
              kind: "execution",
              executionRef: "execution-1",
              accountRef: "account-1",
              authorizationEpoch: 1,
              deadline,
              state: "active",
            },
          },
          bearer: "local-execution-token",
          admission: {
            invocationRef: intent.invocationRef,
            attemptRef: intent.attemptRef,
            accountRef: "account-1",
            authorizationEpoch: 1,
            subjectRef: intent.subjectRef,
            policyRevision: intent.policyRevision,
            bindingRevision: intent.bindingRevision,
            profileId: intent.profileId,
            limits: intent.limits,
            expiresAt: deadline,
          },
        }),
      );
      return;
    }
    if (req.url === "/v1/executions/execution-1/requests") {
      admissions.push(JSON.parse(String(req.headers["x-gateway-admission"])));
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "x-gateway-request-ref": String(req.headers["x-gateway-request-id"]),
      });
      let remaining = streamBytes;
      while (remaining > 0 && !res.destroyed) {
        const size = Math.min(32768, remaining);
        remaining -= size;
        // Valid SSE comment frames remain small; total raw delivery exceeds
        // 1MiB without building a response-sized buffer in either process.
        const chunk =
          size >= 3
            ? Buffer.from(`:${"x".repeat(size - 3)}\n\n`)
            : Buffer.alloc(size, 120);
        if (!res.write(chunk))
          await new Promise<void>((resolve) => {
            const done = () => {
              res.removeListener("drain", done);
              res.removeListener("close", done);
              res.removeListener("error", done);
              resolve();
            };
            res.once("drain", done);
            res.once("close", done);
            res.once("error", done);
          });
      }
      if (!res.destroyed) res.end();
      return;
    }
    if (req.url === "/v1/executions/execution-1/close") {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          operationRef: JSON.parse(raw).operationId,
          state: "applied",
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const runAccess = {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    runControlBearer: "local-control-token",
    timeoutMs: 5000,
  };
  const queries = {
    findReviewRunAuthorizationById: async () => authorization(),
  };
  const preparation = createReviewRunGatewayPreparation({
    authorizationId: "authorization-1",
    identity,
    runAccess,
    authorizations: queries as never,
    snapshots,
    bindings,
  });
  const relay = createReviewRunGatewayRelay({
    policy: {
      profiles: [
        {
          profile: {
            profileId: "profile-1",
            protocol: "openai-responses",
            modelIds: ["gpt-5.6-sol"],
            authKinds: ["oauth"],
          },
          outputTokens: 32768,
        },
      ],
      ingressBytes: 4096,
      requestTimeoutMs: 5000,
      waitBudgetMs: 0,
      maxWaits: 0,
      maxSessions: 2,
      maxInFlight: 2,
    },
    runAccess,
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization: authorization(),
      }),
      expireOrRevokeReviewRunAuthorization: async () => {
        active = false;
        return {} as never;
      },
    },
    queries: queries as never,
    checkAuthority: async () => active,
    confirmAuthority: async () => active,
    snapshots,
    bindings,
  });
  return { preparation, relay, intents, admissions, limits };
}

it.each([
  [MiB, MiB, true],
  [8 * MiB, MiB + 128, true],
  [8 * MiB, 8 * MiB + 1, false],
] as const)(
  "keeps captured raw SSE budget %i with %i streamed bytes",
  async (cap, bytes, accepted) => {
    const f = await fixture(cap, bytes);
    try {
      const response = await f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model: "gpt-5.6-sol",
            input: [],
            stream: true,
            max_output_tokens: 32768,
          }),
        ),
        new AbortController(),
      );
      if (response.kind !== "stream") throw Error("expected_stream");
      const consume = async () => {
        let received = 0;
        for await (const chunk of response.body) received += chunk.byteLength;
        return received;
      };
      if (accepted) expect(await consume()).toBe(bytes);
      else await expect(consume()).rejects.toBeDefined();
      expect(f.intents).toHaveLength(1);
      expect(f.admissions).toHaveLength(1);
      expect(f.intents[0]?.limits).toEqual(f.limits);
      expect(f.admissions[0]?.limits).toEqual(f.limits);
    } finally {
      await f.relay.shutdown();
    }
  },
  10000,
);

it("rejects unsupported captured output before run-access or inference", async () => {
  const f = await fixture(8 * MiB + 1);
  try {
    await expect(f.preparation.prepare()).rejects.toMatchObject({
      code: "invalid_input",
      effect: "not_dispatched",
    });
    await expect(
      f.relay.responses(
        "local-authorization-token",
        new TextEncoder().encode(
          JSON.stringify({
            model: "gpt-5.6-sol",
            input: [],
            stream: true,
            max_output_tokens: 32768,
          }),
        ),
        new AbortController(),
      ),
    ).rejects.toMatchObject({
      code: "gateway_unavailable",
      statusCode: 403,
      effect: "not_dispatched",
    });
    expect(f.intents).toHaveLength(0);
    expect(f.admissions).toHaveLength(0);
  } finally {
    await f.relay.shutdown();
  }
});
