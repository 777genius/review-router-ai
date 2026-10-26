import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { HindsightMemoryProvider } from "../../packages/features/memory/src/infrastructure/hindsight/hindsight-memory-provider.ts";
import {
  HINDSIGHT_MEMORY_PROFILE,
  parseMemoryProviderConfig,
} from "../../packages/features/memory/src/infrastructure/config/memory-provider-config.ts";
import { createMemoryBodyHash } from "../../packages/features/memory/src/domain/memory-body.ts";
import {
  MemoryKnowledgeError,
  memoryKnowledgeDigest,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeCommand,
  type MemoryKnowledgeScope,
} from "../../packages/features/memory/src/domain/memory-knowledge.ts";
import type { MemoryKnowledgeWriter } from "../../packages/features/memory/src/application/ports/memory-knowledge-provider-port.ts";

type Delivery = Parameters<MemoryKnowledgeWriter["submit"]>[0];
const config = {
  kind: "hindsight" as const,
  generation: "native-contract-v1",
  profileVersion: HINDSIGHT_MEMORY_PROFILE,
  baseUrl: "http://native.test",
  apiKey: "SYNTHETIC_NATIVE_KEY",
  namespace: "contract",
  resubmitWindowMs: 0,
};
const scope: MemoryKnowledgeScope = {
  kind: "repository",
  workspaceId: "workspace-a",
  repositoryId: "repo-a",
};
const body = "Use approved transaction boundaries.";
const statementAt = "2026-01-02T03:04:05Z";
const controls = () => ({ deadlineAt: new Date(Date.now() + 2_000) });
export function approvedDelivery(selectedScope = scope): Delivery {
  return {
    command: {
      kind: "save",
      ref: { type: "entry", scope: selectedScope, entryId: "entry-a" },
      commandId: randomUUID(),
      expectedRevision: null,
      generation: config.generation,
      providerProfileVersion: config.profileVersion,
      approval: {
        actor: {
          kind: "workspace_user",
          id: "actor-a",
          githubUserId: null,
          login: null,
        },
        approvedAt: "2026-02-01T00:00:00.000Z",
        authorityRevision: "authority-v1",
      },
      body,
      knowledgeKind: "rule",
      topicIds: ["topic-a"],
      source: {
        type: "manual",
        sourceId: "manual-a",
        revision: "1",
        updatedAt: statementAt,
        statementAt,
        repositoryId: "repo-a",
        pullRequestNumber: null,
        url: null,
        visibility: "private",
        claimedBodyDigest: null,
        observedCommitSha: null,
      },
      applicability: {
        validUntil: null,
        observedCommitSha: null,
        exceptionRule: null,
      },
      temporalMode: "preserve_original",
    },
    revision: "1",
    contentApprovalRevision: "1",
    originalStatementAt: null,
    allowResubmit: true,
    resubmitUntil: new Date(Date.now() + 60_000).toISOString(),
  };
}
const safeError = (code: string) => (error: unknown) =>
  error instanceof MemoryKnowledgeError &&
  error.code === code &&
  !error.message.includes("PRIVATE_PROVIDER_RESPONSE");

function fixture() {
  const delivery = approvedDelivery();
  const calls: { method: string; url: URL; body: unknown }[] = [];
  const sourceId = "94c26d97-7583-4fb0-83af-52686c9af0bd";
  const state = {
    status: "completed",
    childStatuses: ["completed"],
    operationMissing: false,
    malformed: false,
    sourceCount: 1,
    metadataScope: memoryKnowledgeDigest(memoryKnowledgeScopeKey(scope)),
    tags: ["rr:approved", "kind:rule", "topic:topic-a"],
    recall: {
      results: [] as unknown[],
      source_facts: {} as Record<string, unknown>,
      source_facts_truncated: false,
    },
    facts: new Map([[sourceId, "valid"]]),
    documentMissing: false,
    fail: false,
    delayMs: 0,
  };
  const fetcher: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    const payload = raw ? (JSON.parse(raw) as unknown) : null;
    calls.push({ method: request.method, url, body: payload });
    assert.equal(
      request.headers.get("authorization"),
      "Bearer SYNTHETIC_NATIVE_KEY",
    );
    if (state.delayMs)
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (state.fail)
      return json(
        { detail: "PRIVATE_PROVIDER_RESPONSE source body and credential" },
        503,
      );
    if (state.malformed) return json(null);
    const bank = url.pathname.split("/banks/")[1]?.split("/")[0];
    if (url.pathname.endsWith("/config"))
      return json({
        bank_id: bank,
        config: {
          retain_default_strategy: "router-approved-v1",
          retain_strategies: {
            "router-approved-v1": { retain_extraction_mode: "chunks" },
          },
          audit_log_enabled: false,
          store_document_text: true,
        },
        overrides: {},
      });
    if (url.pathname.endsWith("/memories/recall")) return json(state.recall);
    if (url.pathname.includes("/operations/"))
      return state.operationMissing
        ? json({ detail: "missing" }, 404)
        : json({
            operation_id: delivery.command.commandId,
            operation_type: "batch_retain",
            status: state.status,
            child_operations: state.childStatuses.map((status, index) => ({
              operation_id: `${sourceId.slice(0, -1)}${index}`,
              status,
            })),
          });
    if (url.pathname.endsWith("/memories/list")) {
      const items = [...state.facts]
        .filter(([, lifecycle]) => lifecycle === url.searchParams.get("state"))
        .map(([id]) => ({
          id,
          document_id: "entry-entry-a",
          fact_type: "world",
          mentioned_at: "2026-01-02T03:04:05.000Z",
          state: url.searchParams.get("state"),
        }));
      return json({
        items,
        total: state.sourceCount === 1 ? items.length : state.sourceCount,
        limit: 100,
        offset: 0,
      });
    }
    if (url.pathname.endsWith("/documents/entry-entry-a")) {
      if (state.documentMissing) return json({ detail: "missing" }, 404);
      if (request.method === "PATCH")
        state.tags = (payload as { tags: string[] }).tags;
      return json({
        id: "entry-entry-a",
        bank_id: bank,
        original_text: body,
        tags: state.tags,
        content_hash: "native-hash",
        created_at: statementAt,
        updated_at: statementAt,
        memory_unit_count: state.facts.size,
        document_metadata: {
          rr_entry_id: "entry-a",
          rr_kind: "rule",
          rr_content_revision: "1",
          rr_body_digest: createMemoryBodyHash(body),
          rr_statement_at: statementAt,
          rr_profile: config.profileVersion,
          rr_scope: state.metadataScope,
        },
      });
    }
    if (url.pathname.endsWith("/documents"))
      return json({
        items: [{ id: "entry-entry-a" }],
        total: 1,
        limit: 100,
        offset: 0,
      });
    if (request.method === "PATCH" && url.pathname.includes("/memories/")) {
      state.facts.set(url.pathname.split("/").at(-1)!, "invalidated");
      return json({ success: true });
    }
    if (request.method === "GET" && url.pathname.includes("/memories/"))
      return json({ detail: "missing" }, 404);
    if (request.method === "POST" && url.pathname.endsWith("/memories"))
      return json({
        success: true,
        operation_id: (payload as { operation_id: string }).operation_id,
      });
    throw new Error("Unscripted SDK contract request");
  };
  return {
    provider: new HindsightMemoryProvider(config, { fetch: fetcher }),
    delivery,
    state,
    calls,
    sourceId,
  };
}

test("actual SDK carries stable caller UUID, original event time, named chunks, scope and reserved kind", async () => {
  const f = fixture();
  const delivery = {
    ...f.delivery,
    originalStatementAt: "2025-09-01T01:02:03Z",
  };
  await f.provider.submit(delivery, controls());
  await f.provider.submit(delivery, controls());
  const submits = f.calls.filter(
    (call) => call.method === "POST" && call.url.pathname.endsWith("/memories"),
  );
  assert.equal(submits.length, 2);
  assert.deepEqual(submits[0]!.body, submits[1]!.body);
  const payload = submits[0]!.body as {
    operation_id: string;
    items: {
      timestamp: string;
      strategy: string;
      update_mode: string;
      tags: string[];
      observation_scopes: string[][];
      metadata: Record<string, string>;
    }[];
  };
  const item = payload.items[0];
  assert(item);
  assert.equal(payload.operation_id, delivery.command.commandId);
  assert.equal(
    Date.parse(item.timestamp),
    Date.parse(delivery.originalStatementAt),
  );
  assert.equal(item.strategy, "router-approved-v1");
  assert.equal(item.update_mode, "replace");
  assert.deepEqual(item.observation_scopes, [["kind:rule"]]);
  assert(item.tags.includes("kind:rule"));
  assert.equal(
    item.metadata.rr_scope,
    memoryKnowledgeDigest(memoryKnowledgeScopeKey(scope)),
  );
});
test("same-body source time is canonical and a completed parent requires completed children and exact current readback", async () => {
  const f = fixture();
  assert.equal(
    (await f.provider.observe(f.delivery, controls())).state,
    "published",
  );
  f.state.childStatuses = ["processing"];
  assert.equal(
    (await f.provider.observe(f.delivery, controls())).state,
    "processing",
  );
  f.state.childStatuses = [];
  assert.equal(
    (await f.provider.observe(f.delivery, controls())).state,
    "unknown",
  );
});
test("unknown native UUID cannot resubmit after its bounded window or without permission", async () => {
  const f = fixture();
  f.state.operationMissing = true;
  assert.equal(
    (
      await f.provider.observe(
        { ...f.delivery, resubmitUntil: "2020-01-01T00:00:00Z" },
        controls(),
      )
    ).state,
    "unknown",
  );
  assert.equal(
    (
      await f.provider.observe(
        { ...f.delivery, allowResubmit: false },
        controls(),
      )
    ).state,
    "unknown",
  );
  assert(!f.calls.some((call) => call.method === "POST"));
  assert.equal(
    (await f.provider.observe(f.delivery, controls())).state,
    "submitted",
  );
});
test("old generation observation fails before native I/O", async () => {
  const f = fixture();
  await assert.rejects(
    f.provider.observe(
      {
        ...f.delivery,
        command: { ...f.delivery.command, generation: "old-generation" },
      },
      controls(),
    ),
    safeError("conflict"),
  );
  assert.equal(f.calls.length, 0);
});
test("retirement invalidates every source fact and verifies none remain active", async () => {
  const f = fixture();
  f.state.facts.set("94c26d97-7583-4fb0-83af-52686c9af0be", "valid");
  const command: MemoryKnowledgeCommand = {
    ...f.delivery.command,
    kind: "retire",
  };
  assert.equal(
    (await f.provider.submit({ ...f.delivery, command }, controls())).state,
    "completed",
  );
  assert.equal(f.calls.filter((call) => call.method === "PATCH").length, 2);
  assert([...f.state.facts.values()].every((state) => state === "invalidated"));
});
test("topic update preserves reserved publication/kind and checks readback", async () => {
  const f = fixture();
  const command: MemoryKnowledgeCommand = {
    ...f.delivery.command,
    kind: "topics",
    topicIds: ["moved"],
  };
  assert.equal(
    (await f.provider.submit({ ...f.delivery, command }, controls())).state,
    "published",
  );
  assert.deepEqual(f.state.tags, ["rr:approved", "kind:rule", "topic:moved"]);
});
test("truncated observation evidence is hydrated completely or omitted", async () => {
  const f = fixture();
  const missing = "0482961c-e70d-44f9-bbc4-1d611f128463";
  f.state.recall = {
    results: [
      {
        id: "obs-a",
        type: "observation",
        text: "historical synthetic observation",
        source_fact_ids: [f.sourceId, missing],
      },
    ],
    source_facts: {
      [f.sourceId]: { id: f.sourceId, document_id: "entry-entry-a" },
    },
    source_facts_truncated: true,
  };
  const recalled = await f.provider.recall(
    {
      scope,
      query: "transaction",
      limit: 5,
      includeHistoricalObservations: true,
    },
    controls(),
  );
  assert.equal(recalled.length, 0);
  assert(
    f.calls.some((call) => call.url.pathname.endsWith(`/memories/${missing}`)),
  );
});
test("incomplete facts and stripped reserved tags fail closed", async () => {
  const f = fixture();
  f.state.sourceCount = 101;
  await assert.rejects(
    f.provider.read(f.delivery.command.ref, controls()),
    safeError("incomplete_evidence"),
  );
  f.state.sourceCount = 1;
  f.state.tags = ["topic:topic-a"];
  await assert.rejects(
    f.provider.read(f.delivery.command.ref, controls()),
    safeError("incomplete_evidence"),
  );
});
test("SDK nonthrowing HTTP errors, malformed successes and deadlines normalize safely", async () => {
  const f = fixture();
  f.state.fail = true;
  await assert.rejects(
    f.provider.read(f.delivery.command.ref, controls()),
    safeError("unavailable"),
  );
  f.state.fail = false;
  f.state.malformed = true;
  await assert.rejects(
    f.provider.read(f.delivery.command.ref, controls()),
    safeError("unavailable"),
  );
  f.state.malformed = false;
  f.state.delayMs = 30;
  await assert.rejects(
    f.provider.read(f.delivery.command.ref, {
      deadlineAt: new Date(Date.now() + 5),
    }),
    safeError("deadline_exceeded"),
  );
});
test("bank mapping separates repository/workspace/private-user scopes and validates source scope", async () => {
  const f = fixture();
  await f.provider.read(f.delivery.command.ref, controls());
  const second: MemoryKnowledgeScope = {
    kind: "user_preference",
    workspaceId: "workspace-a",
    userId: "user-private",
  };
  await assert.rejects(
    f.provider.read({ ...f.delivery.command.ref, scope: second }, controls()),
    safeError("incomplete_evidence"),
  );
  const banks = new Set(
    f.calls.map((call) => call.url.pathname.split("/banks/")[1]?.split("/")[0]),
  );
  assert.equal(banks.size, 2);
});
test("configuration is local and rejects credential-bearing URLs and unqualified profiles", () => {
  assert.deepEqual(parseMemoryProviderConfig({}), {
    kind: "disabled",
    generation: "memory-v1",
  });
  const env = {
    REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
    REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: HINDSIGHT_MEMORY_PROFILE,
    REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://native.test",
    REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "synthetic-key",
    REVIEW_ROUTER_MEMORY_NAMESPACE: "test",
  };
  assert.equal(parseMemoryProviderConfig(env).kind, "hindsight");
  assert.throws(() =>
    parseMemoryProviderConfig({
      ...env,
      REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://user:password@native.test",
    }),
  );
  assert.throws(() =>
    parseMemoryProviderConfig({
      ...env,
      REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "new-unqualified",
    }),
  );
});

test("stable UUID recovery window is explicit, integer-bounded and restricted to the exact Hindsight profile", () => {
  const env = {
    REVIEW_ROUTER_MEMORY_PROVIDER: "hindsight",
    REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: HINDSIGHT_MEMORY_PROFILE,
    REVIEW_ROUTER_MEMORY_HINDSIGHT_URL: "http://native.test",
    REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY: "synthetic-key",
    REVIEW_ROUTER_MEMORY_NAMESPACE: "test",
  };
  const zero = parseMemoryProviderConfig(env);
  assert(zero.kind === "hindsight");
  assert.equal(zero.resubmitWindowMs, 0);
  for (const value of ["1", "120000", "86400000"]) {
    const config = parseMemoryProviderConfig({
      ...env,
      REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS: value,
    });
    assert(config.kind === "hindsight");
    assert.equal(config.resubmitWindowMs, Number(value));
  }
  for (const value of [
    "-1",
    "0.5",
    "Infinity",
    "NaN",
    "86400001",
    "999999999999999999999999",
    "1e3",
  ])
    assert.throws(
      () =>
        parseMemoryProviderConfig({
          ...env,
          REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS: value,
        }),
      /memory_provider_resubmit_window_invalid/,
    );
  assert.throws(
    () =>
      parseMemoryProviderConfig({
        REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS: "1",
      }),
    /memory_provider_resubmit_unqualified/,
  );
  assert.throws(
    () =>
      parseMemoryProviderConfig({
        ...env,
        REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE: "new-unqualified",
        REVIEW_ROUTER_MEMORY_RESUBMIT_WINDOW_MS: "120000",
      }),
    /memory_provider_profile_unqualified/,
  );
});
