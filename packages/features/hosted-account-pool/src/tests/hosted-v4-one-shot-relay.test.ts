import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalScope,
  defineHostedV4RelayGrant,
  hostedV4LogicalTurnKey,
  hostedV4OneShotApprovalHash,
  hostedV4RelayCanaryPolicyFingerprint,
  hostedV4UnapprovedScopeHash,
  parseHostedV4ScopeCanonical,
  type HostedV4RelayScope,
} from "../domain/hosted-v4-relay-grant";
import type {
  HostedV4DispatchLease,
  HostedV4PreparedRequest,
} from "../application/ports/hosted-v4-relay-turn-port";
import { FetchHostedV4OneShotRelay } from "../infrastructure/http/hosted-v4-one-shot-relay";
import { PrismaHostedV4RelayTurn } from "../infrastructure/prisma/prisma-hosted-v4-relay-turn";
import {
  registerHostedV4OneShotRelayRoute,
  hostedV4ResponsesPath,
} from "../interface/http/register-hosted-v4-one-shot-relay-route";
import {
  HostedCodexSessionRuntime,
  HostedCodexSessionStore,
  HostedCodexMutationFenceLeaseStore,
} from "../infrastructure/runtime/hosted-codex-session-runtime";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
const completed =
  'data: {"type":"response.completed","response":{"id":"resp_sandbox","status":"completed","output":[],"error":null,"incomplete_details":null}}\n\ndata: [DONE]\n\n';
const upstream = (body = completed) =>
  new Response(body, { headers: { "content-type": "text/event-stream" } });

// New isolated fixture, fake identities/credentials, no account or provider IO.
function fixture() {
  const now = new Date();
  const expires = new Date(now.getTime() + 120_000);
  const body = Buffer.from(
    JSON.stringify({
      model: "codex",
      max_output_tokens: 100,
      stream: true,
      input: "sandbox",
    }),
  );
  const budget = JSON.stringify({
    deadline: expires.toISOString(),
    maxGatewayOperations: 16,
    maxOutputFindings: 8,
    maxOutputProposals: 8,
    maxOutputTokens: 100,
    maxRequestBytes: 1_000,
    maxRequests: 1,
    maxResponseBytes: 2_000,
    version: 1,
  });
  const scope: HostedV4RelayScope = {
    version: 4,
    authorizationId: randomUUID(),
    authorizationState: "active",
    mutationEpoch: 1n,
    trustDomain: "trusted_managed",
    investigationCodexRecordingAllowed: true,
    workspaceId: randomUUID(),
    repositoryConnectionId: randomUUID(),
    scmRepositoryIdentityId: randomUUID(),
    githubRepositoryId: "1252762369",
    githubInstallationId: "200",
    pullRequestNumber: 1,
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    headSha: "b".repeat(40),
    reviewRevisionHash: hash("revision"),
    producerReleaseId: "sandbox-release",
    producerReleaseRegistered: true,
    actionIdentityHash: hash("action"),
    runtimeIdentityHash: hash("runtime"),
    gatewayIdentityHash: hash("gateway"),
    protocolVersion: "2",
    schemaDigest: hash("schema"),
    protocolLimitsProfileId: "sandbox-profile",
    providerInstanceId: "hosted-pool:repository:1252762369",
    repositoryBindingId: randomUUID(),
    bindingRevision: 1,
    bindingActive: true,
    repositorySelected: true,
    poolId: randomUUID(),
    poolActive: true,
    poolAuthzEpoch: 1n,
    runtimeGateActive: true,
    runtimeAuthzEpoch: 1n,
    model: "codex",
    policyFingerprint: hostedV4RelayCanaryPolicyFingerprint({
      accountId: "sandbox-account",
      runtimeConfigVersion: 1,
      model: "codex",
      maxRequests: 1,
      maxRequestBytes: 1_000,
      maxResponseBytes: 2_000,
      maxOutputTokens: 100,
    }),
    investigationId: randomUUID(),
    investigationVersion: 1n,
    turnId: randomUUID(),
    turnBudgetCanonicalJson: budget,
    turnBudgetHash: hash(budget),
    turnPurpose: "discovery",
    planningInputDossierDigest: hash("dossier"),
    dossierDigest: hash("dossier"),
    investigationManifestHash: hash("manifest"),
    executionId: randomUUID(),
    workSlotId: randomUUID(),
    providerVoteLaneId: randomUUID(),
    providerStrategyId: randomUUID(),
    attemptId: randomUUID(),
    investigationLease: {
      leaseId: randomUUID(),
      capabilityId: randomUUID(),
      ownerIdHash: hash("investigation-owner"),
      fencingToken: 1n,
      purpose: "relay_turn",
      expiresAt: expires,
    },
    invocationLease: {
      leaseId: randomUUID(),
      capabilityId: randomUUID(),
      ownerIdHash: hash("invocation-owner"),
      fencingToken: 1n,
      purpose: "provider_execution",
      attemptId: randomUUID(),
      providerInvocationKey: randomUUID(),
      expiresAt: expires,
    },
    authorizationExpiresAt: expires,
    turnExpiresAt: expires,
    policyExpiresAt: expires,
  };
  const grantId = `v4-grant-${hostedV4LogicalTurnKey(scope.investigationId, scope.turnId)}`;
  const idempotencyKey = "sandbox-request";
  const payload = {
    approvalId: randomUUID(),
    purpose: "owner_one_shot_uncapped_test" as const,
    githubRepositoryId: "1252762369" as const,
    accountId: "sandbox-account",
    unapprovedScopeHash: hostedV4UnapprovedScopeHash(scope),
    grantId,
    sourceCommit: "c".repeat(40),
    requestHash: hash(body),
    idempotencyKeyHash: hash(
      JSON.stringify(["hosted-v4-request", grantId, idempotencyKey]),
    ),
    expiresAt: expires.toISOString(),
  };
  const approval = {
    ...payload,
    approvalHash: hostedV4OneShotApprovalHash(payload),
  };
  const contract = defineHostedV4RelayGrant({
    scope: { ...scope, ownerOneShotApproval: approval },
    now,
    maxRequests: 1,
    maxRequestBytes: 1_000,
    maxResponseBytes: 2_000,
    maxOutputTokens: 100,
  });
  const authorization = {
    authorityKind: "v4_relay_turn" as const,
    contract,
    grantId,
    accountId: "sandbox-account",
    runId: "sandbox-run",
    runAttempt: 1,
  };
  const input = {
    authorization,
    body,
    idempotencyKey,
    abortSignal: new AbortController().signal,
  };
  const prepared: HostedV4PreparedRequest = {
    status: "prepared",
    grantId,
    requestId: randomUUID(),
    effectId: randomUUID(),
    ordinal: 1,
    requestHash: hash(body),
  };
  const events: string[] = [];
  const turns = {
    assertCurrentGrant: vi.fn(async () => undefined),
    reservePreparedRequest: vi.fn(async () => {
      events.push("prepared");
      return prepared;
    }),
    beginDispatch: vi.fn(async () => {
      events.push("durable-dispatch");
    }),
    heartbeatDispatch: vi.fn(async () => {
      events.push("heartbeat");
    }),
    markDispatchResponseStarted: vi.fn(async () => {
      events.push("response-started");
    }),
    completeDispatchResponse: vi.fn(async () => {
      events.push("complete");
    }),
    markTerminalUnknown: vi.fn(async () => {
      events.push("unknown");
    }),
  };
  const runtime = {
    readFreshSessionWithoutRefresh: vi.fn(async () => ({
      accessToken: "fake-test-token",
      chatgptAccountId: "fake-test-account",
      credentialGeneration: 1,
    })),
  };
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    events.push("fetch");
    return upstream();
  });
  const deps = {
    approval,
    turns,
    runtime,
    fetch: fetchImpl,
    now: () => now,
    heartbeatIntervalMs: 5,
  };
  return { ...deps, input, prepared, events, deps };
}

describe("one-shot V4 transport", () => {
  // Regression: an unapproved/different tuple accidentally reaches credential
  // access or fetch, even though ordinary transport remains unqualified.
  it.each([
    "missing",
    "normal-scope",
    "account",
    "repo",
    "authorization",
    "turn",
    "fence",
    "head",
    "body",
    "key",
    "expiry",
    "approvalHash",
    "sourceCommit",
  ])("unapproved_or_wrong_tuple_never_dispatches: %s", async (change) => {
    const f = fixture();
    const deps: ConstructorParameters<typeof FetchHostedV4OneShotRelay>[0] = {
      ...f.deps,
    };
    const input = {
      ...f.input,
      authorization: {
        ...f.input.authorization,
        contract: {
          ...f.input.authorization.contract,
          scope: { ...f.input.authorization.contract.scope },
        },
      },
    };
    if (change === "missing") deps.approval = null;
    if (change === "normal-scope")
      delete input.authorization.contract.scope.ownerOneShotApproval;
    if (change === "account") input.authorization.accountId = "another-account";
    if (change === "repo")
      input.authorization.contract.scope.githubRepositoryId = "42";
    if (change === "authorization")
      input.authorization.contract.scope.authorizationId = randomUUID();
    if (change === "turn")
      input.authorization.contract.scope.turnId = randomUUID();
    if (change === "fence")
      input.authorization.contract.scope.invocationLease = {
        ...input.authorization.contract.scope.invocationLease,
        fencingToken: 2n,
      };
    if (change === "head")
      input.authorization.contract.scope.headSha = "d".repeat(40);
    if (change === "body") input.body = Buffer.from("{}");
    if (change === "key") input.idempotencyKey = "another-key";
    if (change === "expiry") deps.now = () => new Date(Date.now() + 600_000);
    if (change === "approvalHash")
      deps.approval = { ...f.approval, approvalHash: hash("forged") };
    if (change === "sourceCommit")
      deps.approval = { ...f.approval, sourceCommit: "d".repeat(40) };
    await expect(
      new FetchHostedV4OneShotRelay(deps).open(input),
    ).rejects.toThrow();
    expect(f.runtime.readFreshSessionWithoutRefresh).not.toHaveBeenCalled();
    expect(f.turns.reservePreparedRequest).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("dispatch_claim_precedes_fetch_and_output_waiver_is_local", async () => {
    const f = fixture();
    const result = await new FetchHostedV4OneShotRelay(f.deps).open(f.input);
    expect(f.events).toEqual([
      "prepared",
      "durable-dispatch",
      "fetch",
      "response-started",
      "complete",
    ]);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0]![0]).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    // Capture the sent body inside fetch because the relay wipes its buffer.
    expect(result.body.toString()).toBe(completed);
    expect(f.turns.completeDispatchResponse.mock.calls[0]).toBeDefined();
    expect(f.turns.markTerminalUnknown).not.toHaveBeenCalled();
  });

  it("provider_body_drops_only_unsupported_cap_and_pins_model", async () => {
    const f = fixture();
    let sent: Record<string, unknown> | undefined;
    f.fetch.mockImplementation(async (_url, init) => {
      sent = JSON.parse(Buffer.from(init!.body as Uint8Array).toString());
      return upstream();
    });
    await new FetchHostedV4OneShotRelay(f.deps).open(f.input);
    expect(sent).toEqual({
      model: "codex",
      stream: true,
      input: "sandbox",
      store: false,
    });
    expect(sent).not.toHaveProperty("max_output_tokens");
  });

  it("one_shot_concurrent_reservations_send_only_the_fresh_winner", async () => {
    const f = fixture();
    let claimed = false;
    // This test proves dispatcher's restored-result contract, not PG debit
    // atomicity. The separate disposable-PG lifecycle gate is still required.
    f.turns.reservePreparedRequest.mockImplementation(async () => {
      if (claimed) return { ...f.prepared, status: "restored" };
      claimed = true;
      return f.prepared;
    });
    const relay = new FetchHostedV4OneShotRelay(f.deps);
    const results = await Promise.allSettled([
      relay.open(f.input),
      relay.open(f.input),
    ]);
    expect(
      results.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.turns.beginDispatch).toHaveBeenCalledTimes(1);
    expect(f.turns.markTerminalUnknown).not.toHaveBeenCalled();
  });

  it.each(["restored", "recovery_required"] as const)(
    "restored_prepared_reservation_never_resends: %s",
    async (status) => {
      const f = fixture();
      f.turns.reservePreparedRequest.mockResolvedValue({
        ...f.prepared,
        status,
      });
      await expect(
        new FetchHostedV4OneShotRelay(f.deps).open(f.input),
      ).rejects.toThrow("no_resend");
      expect(f.fetch).not.toHaveBeenCalled();
      expect(f.turns.beginDispatch).not.toHaveBeenCalled();
      expect(f.turns.markTerminalUnknown).not.toHaveBeenCalled();
    },
  );

  it("ambiguous_dispatch_commit_never_reaches_fetch_or_retries", async () => {
    const f = fixture();
    f.turns.beginDispatch.mockRejectedValue(new Error("ack lost"));
    await expect(
      new FetchHostedV4OneShotRelay(f.deps).open(f.input),
    ).rejects.toThrow("no_retry");
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.turns.beginDispatch).toHaveBeenCalledTimes(1);
    expect(f.turns.markTerminalUnknown).toHaveBeenCalledTimes(1);
  });

  it.each([401, 429, 500])(
    "provider_failure_has_no_retry_or_failover: %s",
    async (status) => {
      const f = fixture();
      f.fetch.mockResolvedValue(new Response("failure", { status }));
      await expect(
        new FetchHostedV4OneShotRelay(f.deps).open(f.input),
      ).rejects.toThrow("no_retry");
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.runtime.readFreshSessionWithoutRefresh).toHaveBeenCalledTimes(1);
      expect(f.turns.completeDispatchResponse).not.toHaveBeenCalled();
      expect(f.turns.markTerminalUnknown).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["timeout", "disconnect"])(
    "uncertain_fetch_never_retries: %s",
    async (code) => {
      const f = fixture();
      f.fetch.mockRejectedValue(new Error(code));
      await expect(
        new FetchHostedV4OneShotRelay(f.deps).open(f.input),
      ).rejects.toThrow("no_retry");
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.turns.completeDispatchResponse).not.toHaveBeenCalled();
    },
  );

  it.each([
    "data: [DONE]\n\n",
    'data: {"type":"response.incomplete"}\n\n',
    completed.repeat(2),
  ])("EOF_or_invalid_terminal_event_does_not_become_success", async (body) => {
    const f = fixture();
    f.fetch.mockResolvedValue(upstream(body));
    await expect(
      new FetchHostedV4OneShotRelay(f.deps).open(f.input),
    ).rejects.toThrow("no_retry");
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.turns.completeDispatchResponse).not.toHaveBeenCalled();
  });

  // Regression: a superficially completed frame hides contradictory identity,
  // error evidence, truncated SSE framing, or a second post-terminal payload.
  it.each([
    ["missing-id", completed.replace('"id":"resp_sandbox",', "")],
    ["empty-id", completed.replace('"id":"resp_sandbox"', '"id":""')],
    [
      "error",
      completed.replace('"error":null', '"error":{"message":"failure"}'),
    ],
    [
      "incomplete-details",
      completed.replace(
        '"incomplete_details":null',
        '"incomplete_details":{"reason":"max_tokens"}',
      ),
    ],
    [
      "wrong-early-id",
      'data: {"type":"response.created","response":{"id":"resp_other","status":"in_progress"}}\n\n' +
        completed,
    ],
    [
      "wrong-response-id",
      completed.replace(
        '"type":"response.completed"',
        '"type":"response.completed","response_id":"resp_other"',
      ),
    ],
    [
      "truncated-terminal-frame",
      completed.slice(0, completed.indexOf("\n\n")) + "\n",
    ],
    [
      "truncated-after-terminal",
      completed + 'data: {"type":"response.output_text.delta"}',
    ],
    [
      "post-terminal-delta",
      completed +
        'data: {"type":"response.output_text.delta","delta":"extra"}\n\n',
    ],
    ["post-terminal-completed", completed + completed],
    ["conflicting-event-name", "event: response.failed\n" + completed],
    [
      "duplicate-event-name",
      "event: response.completed\nevent: response.completed\n" + completed,
    ],
    ["early-DONE", "data: [DONE]\n\n" + completed],
    ["duplicate-DONE", completed + "data: [DONE]\n\n"],
    [
      "named-DONE",
      completed.replace(
        "data: [DONE]",
        "event: response.completed\ndata: [DONE]",
      ),
    ],
    ["control-after-terminal", completed + "id: another-response\n\n"],
    ["sticky-failure", 'data: {"type":"response.failed"}\n\n' + completed],
    [
      "sticky-error",
      'data: {"type":"response.output_text.delta","error":{"message":"failure"}}\n\n' +
        completed,
    ],
  ])(
    "contradictory_or_unframed_SSE_never_completes: %s",
    async (_name, body) => {
      const f = fixture();
      f.fetch.mockResolvedValue(upstream(body));
      await expect(
        new FetchHostedV4OneShotRelay(f.deps).open(f.input),
      ).rejects.toThrow("no_retry");
      expect(f.fetch).toHaveBeenCalledTimes(1);
      expect(f.turns.completeDispatchResponse).not.toHaveBeenCalled();
      expect(f.turns.markTerminalUnknown).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["\n", "\r\n", "\r"])(
    "accepts_multiline_JSON_and_fully_framed_SSE_line_endings: %s",
    async (ending) => {
      const f = fixture();
      const body = [
        ": sandbox keepalive",
        "",
        "event: response.created",
        'data: {"type":"response.created",',
        'data: "response":{"id":"resp_sandbox","status":"in_progress"}}',
        "",
        "event: response.completed",
        'data: {"type":"response.completed",',
        'data: "response":{"id":"resp_sandbox","status":"completed","error":null,"incomplete_details":null}}',
        "",
        "data: [DONE]",
        "",
        "",
      ].join(ending);
      f.fetch.mockResolvedValue(upstream(body));
      const result = await new FetchHostedV4OneShotRelay(f.deps).open(f.input);
      expect(result.body.toString()).toBe(body);
      expect(f.turns.completeDispatchResponse).toHaveBeenCalledTimes(1);
      expect(f.turns.markTerminalUnknown).not.toHaveBeenCalled();
    },
  );

  it("valid_completed_frame_does_not_require_DONE_and_invalid_UTF8_is_fatal", async () => {
    const f = fixture();
    f.fetch.mockResolvedValue(
      upstream(completed.slice(0, completed.indexOf("data: [DONE]"))),
    );
    await new FetchHostedV4OneShotRelay(f.deps).open(f.input);
    expect(f.turns.completeDispatchResponse).toHaveBeenCalledTimes(1);
    const invalid = fixture();
    invalid.fetch.mockResolvedValue(
      new Response(
        Buffer.concat([Buffer.from(completed), Buffer.from([0xff, 10, 10])]),
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
    await expect(
      new FetchHostedV4OneShotRelay(invalid.deps).open(invalid.input),
    ).rejects.toThrow("no_retry");
    expect(invalid.turns.completeDispatchResponse).not.toHaveBeenCalled();
  });

  it("unqualified_session_is_not_refreshed_and_causes_zero_debits_or_provider_calls", async () => {
    const f = fixture();
    f.runtime.readFreshSessionWithoutRefresh.mockRejectedValue(
      new Error("prequalified_session_required"),
    );
    await expect(
      new FetchHostedV4OneShotRelay(f.deps).open(f.input),
    ).rejects.toThrow("prequalified_session_required");
    expect(f.runtime.readFreshSessionWithoutRefresh).toHaveBeenCalledTimes(1);
    expect(f.turns.reservePreparedRequest).not.toHaveBeenCalled();
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it("completion_fence_loss_does_not_expose_success", async () => {
    const f = fixture();
    f.turns.completeDispatchResponse.mockRejectedValue(new Error("fence lost"));
    await expect(
      new FetchHostedV4OneShotRelay(f.deps).open(f.input),
    ).rejects.toThrow("no_retry");
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.turns.markTerminalUnknown).toHaveBeenCalledTimes(1);
  });

  it("heartbeat_fence_loss_aborts_fetch_and_cannot_complete", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.turns.heartbeatDispatch.mockRejectedValue(new Error("fence lost"));
    f.fetch.mockImplementation(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const result = new FetchHostedV4OneShotRelay(f.deps).open(f.input);
    const rejected = expect(result).rejects.toThrow("no_retry");
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.turns.heartbeatDispatch).toHaveBeenCalledTimes(1);
    expect(f.turns.completeDispatchResponse).not.toHaveBeenCalled();
  });
});

describe("one-shot V4 durable owner gate", () => {
  it("saved_scope_roundtrips_strict_dates_and_bigints_without_accepting_alternate_encoding", () => {
    const f = fixture();
    const saved = canonicalScope(f.input.authorization.contract.scope);
    const parsed = parseHostedV4ScopeCanonical(saved);
    expect(parsed).toEqual(f.input.authorization.contract.scope);
    expect(typeof parsed.mutationEpoch).toBe("bigint");
    expect(parsed.invocationLease.expiresAt).toBeInstanceOf(Date);
    expect(() => parseHostedV4ScopeCanonical(` ${saved}`)).toThrow(
      "canonical_invalid",
    );
    expect(() =>
      parseHostedV4ScopeCanonical(
        saved.replace('"mutationEpoch":"1"', '"mutationEpoch":1'),
      ),
    ).toThrow("canonical_invalid");
  });
  // Regression: a stale owner/fence/expired effect reaches any lifecycle write.
  it.each(["owner", "fence", "expiry", "replay"])(
    "heartbeat_and_dispatch_are_fenced: %s",
    async (change) => {
      const f = fixture();
      const contract = f.input.authorization.contract;
      vi.stubEnv("REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED", "1");
      vi.stubEnv(
        "REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID",
        "1252762369",
      );
      const ownerIdHash = hash("expected-owner");
      const lease: HostedV4DispatchLease = {
        contract,
        prepared: f.prepared,
        accountId: "sandbox-account",
        credentialGeneration: 1n,
        ownerIdHash,
        fenceEpoch: 1n,
        idempotencyKey: f.input.idempotencyKey,
      };
      const effect = {
        id: f.prepared.effectId,
        authorityKind: "v4_relay_turn",
        grantId: f.prepared.grantId,
        relayRequestId: f.prepared.requestId,
        attemptOrdinal: 1,
        requestHash: f.prepared.requestHash,
        accountId: "sandbox-account",
        credentialGeneration: 1n,
        ownerIdHash: change === "owner" ? hash("other-owner") : ownerIdHash,
        fenceEpoch: change === "fence" ? 2n : 1n,
        leaseExpiresAt:
          change === "expiry" ? new Date(0) : new Date(Date.now() + 30_000),
        state: change === "replay" ? "dispatching" : "response_started",
        dispatchStartedAt: new Date(),
      };
      const tx = {
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([{ epochMs: BigInt(Date.now()) }])
          .mockResolvedValueOnce([
            {
              producerReleaseId: contract.scope.producerReleaseId,
              state: "registered",
            },
          ])
          .mockResolvedValueOnce([
            {
              scopeHash: contract.scopeHash,
              scopeCanonical: canonicalScope(contract.scope),
              state: "open",
              expiresAt: contract.expiresAt,
              maxRequests: contract.maxRequests,
              maxRequestBytes: contract.maxRequestBytes,
              maxResponseBytes: contract.maxResponseBytes,
              maxOutputTokens: contract.maxOutputTokens,
            },
          ]),
        hostedCodexInvocationGrant: {
          findUnique: vi.fn().mockResolvedValue({
            id: f.prepared.grantId,
            authorityKind: "v4_relay_turn",
            v4TurnKey: contract.logicalTurnKey,
            v4ScopeHash: contract.scopeHash,
            primaryAccountId: "sandbox-account",
            activeAccountId: "sandbox-account",
            backupAccountId: null,
            status: "exhausted",
            requestCount: 1,
            inFlight: 1,
            expiresAt: contract.expiresAt,
          }),
        },
        hostedCodexUpstreamEffectAttempt: {
          findUnique: vi.fn().mockResolvedValue(effect),
          updateMany: vi.fn(),
        },
        hostedCodexRelayRequest: { updateMany: vi.fn() },
      };
      const transaction = vi.fn(
        async (callback: (value: typeof tx) => Promise<void>) => callback(tx),
      );
      const store = new PrismaHostedV4RelayTurn({
        $transaction: transaction,
      } as unknown as PrismaClient);
      await expect(
        change === "replay"
          ? store.beginDispatch(lease)
          : store.heartbeatDispatch(lease),
      ).rejects.toThrow("hosted_v4_dispatch_owner_stale");
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(
        tx.hostedCodexUpstreamEffectAttempt.updateMany,
      ).not.toHaveBeenCalled();
      expect(tx.hostedCodexRelayRequest.updateMany).not.toHaveBeenCalled();
    },
  );
});

describe("one-shot V4 route", () => {
  it("hashes_exact_admitted_bytes_and_exposes_truthful_waiver", async () => {
    const f = fixture();
    const app = Fastify();
    const authorization = {
      authorize: vi.fn(async () => f.input.authorization),
    };
    await registerHostedV4OneShotRelayRoute(app, {
      authorization,
      relay: new FetchHostedV4OneShotRelay(f.deps),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: hostedV4ResponsesPath,
        headers: {
          authorization: "Bearer fake-opaque-grant",
          "content-type": "application/json",
          "content-length": String(f.input.body.byteLength),
          "idempotency-key": f.input.idempotencyKey,
          "x-reviewrouter-request-ordinal": "1",
        },
        payload: Buffer.from(f.input.body),
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(completed);
      expect(response.headers["x-reviewrouter-output-token-policy"]).toBe(
        "owner-one-shot-uncapped-test",
      );
      expect(authorization.authorize).toHaveBeenCalledWith({
        opaqueGrant: "fake-opaque-grant",
        idempotencyKey: f.input.idempotencyKey,
        requestOrdinal: 1,
        requestHash: f.approval.requestHash,
        requestBytes: f.input.body.byteLength,
      });
    } finally {
      await app.close();
    }
  });

  it("missing_bearer_or_wrong_ordinal_has_zero_dispatch", async () => {
    const f = fixture();
    const app = Fastify();
    const authorization = {
      authorize: vi.fn(async () => f.input.authorization),
    };
    await registerHostedV4OneShotRelayRoute(app, {
      authorization,
      relay: new FetchHostedV4OneShotRelay(f.deps),
    });
    try {
      const response = await app.inject({
        method: "POST",
        url: hostedV4ResponsesPath,
        headers: {
          "content-type": "application/json",
          "idempotency-key": f.input.idempotencyKey,
          "x-reviewrouter-request-ordinal": "2",
        },
        payload: Buffer.from(f.input.body),
      });
      expect(response.statusCode).toBe(400);
      expect(authorization.authorize).not.toHaveBeenCalled();
      expect(f.fetch).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe("stored qualified session without model bootstrap", () => {
  it.each([
    "fresh",
    "expired",
    "unknown-expiry",
    "expires-during-grant",
    "old-refresh",
  ])(
    "supported_read_and_inspect_never_refreshes_or_acquires_a_runner: %s",
    async (state) => {
      const now = Date.now();
      const expiry =
        state === "expired"
          ? now - 1_000
          : state === "expires-during-grant"
            ? now + 30_000
            : now + 60 * 60_000;
      const idToken = `sandbox.${Buffer.from(
        JSON.stringify({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "fake-test-account",
          },
        }),
      ).toString("base64url")}.sandbox`;
      const auth = Buffer.from(
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            access_token: "fake-test-token",
            refresh_token: "fake-test-refresh",
            id_token: idToken,
            ...(state === "unknown-expiry"
              ? {}
              : { expiry: new Date(expiry).toISOString() }),
          },
          last_refresh: new Date(
            state === "old-refresh" ? now - 2 * 24 * 60 * 60_000 : now,
          ).toISOString(),
        }),
      );
      const read = vi.fn(async () => ({
        accountId: "sandbox-account",
        authJsonBytes: auth,
        generation: 1,
        generationHash: hash(auth),
        storageVersion: "synthetic",
      }));
      const compareAndSwap = vi.fn(async () => {
        throw new Error("unexpected writeback");
      });
      const unexpected = vi.fn(async () => {
        throw new Error("unexpected bootstrap lease");
      });
      const runtime = new HostedCodexSessionRuntime({
        sessionStore: new HostedCodexSessionStore({ read, compareAndSwap }),
        leaseStore: new HostedCodexMutationFenceLeaseStore({
          acquire: unexpected,
          finalize: unexpected,
          markWritebackStarted: unexpected,
          markWritebackCommitted: unexpected,
          release: unexpected,
        }),
        sourceEnv: {},
      });
      const refresh = vi.spyOn(runtime.sessionDriver, "refreshSession");
      const result = runtime.readFreshSessionWithoutRefresh({
        accountId: "sandbox-account",
        validUntil: new Date(now + 120_000),
        abortSignal: new AbortController().signal,
      });
      if (state === "fresh") {
        await expect(result).resolves.toEqual({
          accessToken: "fake-test-token",
          chatgptAccountId: "fake-test-account",
          credentialGeneration: 1,
        });
      } else
        await expect(result).rejects.toThrow("prequalified_session_required");
      expect(read).toHaveBeenCalledTimes(1);
      expect(compareAndSwap).not.toHaveBeenCalled();
      expect(unexpected).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(auth.every((byte) => byte === 0)).toBe(true);
    },
  );
});
