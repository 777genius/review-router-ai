import { afterEach, describe, expect, it } from "vitest";
import {
  ReviewMemoryRuntimeGateway,
  registerReviewMemoryRuntimeRoutes,
} from "./review-memory-runtime";
import type { ReviewRunAuthorization } from "@reviewrouter/features-review-run-control";
import { createActionMemoryHttpPeer } from "./test-support/action-memory-http-peer";
const apps: Awaited<ReturnType<typeof createActionMemoryHttpPeer>>["app"][] =
  [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
const auth = { authorization: "Bearer session-token" };
const first = "123e4567-e89b-42d3-a456-426614174000";
const next = "223e4567-e89b-42d3-a456-426614174000";
async function fixture() {
  const peer = await createActionMemoryHttpPeer();
  apps.push(peer.app);
  return peer;
}
async function add(
  peer: Awaited<ReturnType<typeof fixture>>,
  requestedScope = "repository",
) {
  return peer.app.inject({
    method: "POST",
    url: "/api/action/v2/memory/candidates",
    headers: auth,
    payload: {
      protocolVersion: 2,
      commandId: first,
      expectedRevision: null,
      kind: "rule",
      requestedScope,
      candidateBody: "Use UTC for stored event times.",
      intent: "explicit_command",
      extractionMethod: "explicit_command",
      extractionVersion: 1,
      source: peer.source,
    },
  });
}
describe("independent real Fastify Action memory command contracts", () => {
  it("queues explicit approval with a stable entry identity and removes private source links when promoted", async () => {
    const peer = await fixture();
    const result = await add(peer, "workspace");
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({
      status: "queued",
      id: first,
      entryId: `mem_${first.replaceAll("-", "")}`,
      revision: "1",
    });
    expect(peer.state.admissions).toBe(1);
    expect([...peer.entries.values()][0]?.source?.url).toBeNull();
    expect(result.body).not.toContain("Use UTC");
    expect(result.headers["cache-control"]).toContain("no-store");
  });
  it("denies a viewer before native/provider read or any command admission", async () => {
    const peer = await fixture();
    peer.state.role = "member";
    const result = await add(peer);
    expect(result.statusCode).toBe(403);
    expect(peer.state.admissions).toBe(0);
    expect(peer.state.providerReads).toBe(0);
  });
  it("updates the same entry with current body/topics, then replays after purge without reopening the provider", async () => {
    const peer = await fixture();
    const created = (await add(peer)).json();
    peer.publish(first);
    const command = {
      kind: "update_memory",
      commandId: next,
      memoryItemId: created.entryId,
      expectedRevision: "1",
      body: "Use UTC timestamps for stored event times and exports.",
    };
    const request = () =>
      peer.app.inject({
        method: "POST",
        url: "/api/action/v2/memory/commands",
        headers: auth,
        payload: {
          protocolVersion: 2,
          commands: [command],
          source: peer.source,
        },
      });
    const result = await request();
    expect(result.statusCode).toBe(200);
    expect(result.json().results[0]).toMatchObject({
      status: "queued",
      entryId: created.entryId,
      revision: "2",
    });
    expect(peer.entries.size).toBe(1);
    expect(peer.state.providerReads).toBe(1);
    peer.publish(next);
    const replay = await request();
    expect(replay.statusCode).toBe(200);
    expect(replay.json().results[0].status).toBe("published");
    expect(peer.state.providerReads).toBe(1);
    expect(peer.state.admissions).toBe(2);
    const changed = await peer.app.inject({
      method: "POST",
      url: "/api/action/v2/memory/commands",
      headers: auth,
      payload: {
        protocolVersion: 2,
        commands: [{ ...command, body: "Different approved text." }],
        source: peer.source,
      },
    });
    expect(changed.statusCode).toBe(409);
    expect(peer.state.providerReads).toBe(1);
    const query = new URLSearchParams({
      commandId: next,
      sourceId: peer.source.sourceId,
      sourceNodeId: peer.source.nodeId,
      sourceRevision: peer.source.revision,
      pullRequestNumber: "7",
      headSha: peer.source.headSha,
      baseSha: peer.source.baseSha,
      githubRepositoryId: "1234",
      sourceType: peer.source.type,
    });
    const detail = await peer.app.inject({
      method: "GET",
      url: `/api/action/v2/memory/entries/${created.entryId}?${query}`,
      headers: auth,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().revision).toBe("1");
  });
  it("rejects forged authority fields and absent source without reaching source/provider peers", async () => {
    const peer = await fixture();
    for (const payload of [
      {
        protocolVersion: 2,
        commands: [{ kind: "list_memory", commandId: first, view: "active" }],
      },
      {
        protocolVersion: 2,
        commands: [{ kind: "list_memory", commandId: first, view: "active" }],
        source: peer.source,
        actor: { id: "admin" },
      },
    ]) {
      const result = await peer.app.inject({
        method: "POST",
        url: "/api/action/v2/memory/commands",
        headers: auth,
        payload,
      });
      expect(result.statusCode).toBe(400);
    }
    expect(peer.state.sourceReads).toBe(0);
    expect(peer.state.admissions).toBe(0);
  });
  it("keeps retire/forget/status asynchronous and never echoes approved text into the public command response", async () => {
    const peer = await fixture();
    const created = (await add(peer)).json();
    peer.publish(first);
    const commands = async (command: Record<string, unknown>) =>
      peer.app.inject({
        method: "POST",
        url: "/api/action/v2/memory/commands",
        headers: auth,
        payload: {
          protocolVersion: 2,
          source: peer.source,
          commands: [command],
        },
      });
    const retired = await commands({
      kind: "disable_memory",
      commandId: next,
      memoryItemId: created.entryId,
      expectedRevision: "1",
    });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().results[0]).toMatchObject({
      status: "queued",
      revision: "2",
    });
    peer.publish(next);
    const forgetId = "323e4567-e89b-42d3-a456-426614174000";
    const forgotten = await commands({
      kind: "forget_memory",
      commandId: forgetId,
      memoryItemId: created.entryId,
      expectedRevision: "2",
    });
    expect(forgotten.json().results[0]).toMatchObject({
      status: "queued",
      revision: "3",
    });
    peer.publish(forgetId);
    const status = await commands({
      kind: "operation_status",
      commandId: "423e4567-e89b-42d3-a456-426614174000",
      operationId: forgetId,
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().results[0]).toMatchObject({
      status: "cleanup_pending",
      id: forgetId,
      entryId: created.entryId,
    });
    expect(status.body).not.toContain("Use UTC");
    expect(peer.entries.size).toBe(1);
  });

  it("uses real runtime routes/facade/receipt admission for approved recall and rejects it after revocation", async () => {
    const peer = await fixture();
    const binding = {
      authorizationId: "authorization_http",
      repositoryConnectionId: "repo_1",
      pullRequestNumber: 7,
      baseSha: peer.source.baseSha,
      headSha: peer.source.headSha,
      reviewRevisionHash: "d".repeat(64),
    };
    const authorization = {
      ...binding,
      workspaceId: "workspace_1",
      trustDomain: "trusted_managed",
      mutationEpoch: 1n,
      runtimeSnapshotCanonicalJson: "{}",
    } as ReviewRunAuthorization;
    await registerReviewMemoryRuntimeRoutes(
      peer.app,
      new ReviewMemoryRuntimeGateway({
        prisma: peer.prisma,
        runtime: peer.runtime,
        access: {
          async authorize(token) {
            return token === "execution-token" ? authorization : null;
          },
        },
      }),
    );
    const created = (await add(peer)).json();
    peer.publish(first);
    const headers = { authorization: "Bearer execution-token" };
    const captured = await peer.app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: { protocolVersion: 2, ...binding },
    });
    expect(captured.statusCode).toBe(200);
    const bundle = captured.json();
    expect(bundle.items[0]).toMatchObject({
      id: created.entryId,
      kind: "rule",
      body: "Use UTC for stored event times.",
    });
    const admission = {
      protocolVersion: 2,
      ...binding,
      bundleId: bundle.bundleId,
      eligibilityEpoch: bundle.eligibilityEpoch,
      policyVersion: bundle.policyVersion,
      providerGeneration: bundle.providerGeneration,
    };
    const admit = () =>
      peer.app.inject({
        method: "POST",
        url: "/api/action/v2/memory/admit",
        headers,
        payload: admission,
      });
    expect((await admit()).json()).toEqual({
      protocolVersion: 2,
      eligible: true,
    });
    await peer.app.inject({
      method: "POST",
      url: "/api/action/v2/memory/commands",
      headers: auth,
      payload: {
        protocolVersion: 2,
        source: peer.source,
        commands: [
          {
            kind: "disable_memory",
            commandId: next,
            memoryItemId: created.entryId,
            expectedRevision: "1",
          },
        ],
      },
    });
    expect((await admit()).json()).toEqual({
      protocolVersion: 2,
      eligible: false,
    });
    const rawQuery = await peer.app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: {
        protocolVersion: 2,
        ...binding,
        safeRetrievalQuery: "UNAPPROVED SOURCE TEXT",
      },
    });
    expect(rawQuery.statusCode).toBe(400);
    expect(rawQuery.body).not.toContain("UNAPPROVED SOURCE TEXT");
  });
});
