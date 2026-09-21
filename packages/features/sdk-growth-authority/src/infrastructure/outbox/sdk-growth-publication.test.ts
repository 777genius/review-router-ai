import { describe, expect, it } from "vitest";
import type {
  PublicationHandoffStore,
  PublicationSeed,
} from "../../application/publication-ports";
import { buildPublicationSeed } from "../../application/publication";
import {
  SdkGrowthPublicationOutboxBridge,
  type PublicationOutboxPort,
} from "./sdk-growth-publication";

class FakeHandoffs implements PublicationHandoffStore {
  readonly seeds = new Map<string, PublicationSeed>();
  readonly links = new Map<string, string>();

  async load(intentId: string) {
    return this.seeds.get(intentId) ?? null;
  }
  async listUnqueued(limit: number) {
    return [...this.seeds.values()]
      .filter((seed) => !this.links.has(seed.intentId))
      .slice(0, limit);
  }
  async link(intentId: string, envelopeDigest: string, eventId: string) {
    const seed = this.seeds.get(intentId);
    if (!seed || seed.envelopeDigest !== envelopeDigest) {
      return "conflict" as const;
    }
    const existing = this.links.get(intentId);
    if (existing && existing !== eventId) return "conflict" as const;
    if (existing) return "already-linked" as const;
    this.links.set(intentId, eventId);
    return "linked" as const;
  }
}

class FakeOutbox implements PublicationOutboxPort {
  readonly events = new Map<
    string,
    Parameters<PublicationOutboxPort["enqueue"]>[0]
  >();
  loseAcknowledgement = false;

  async enqueue(event: Parameters<PublicationOutboxPort["enqueue"]>[0]) {
    const existing = this.events.get(event.idempotencyKey);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) {
      throw new Error("outbox_idempotency_conflict");
    }
    this.events.set(event.idempotencyKey, event);
    if (this.loseAcknowledgement) {
      this.loseAcknowledgement = false;
      throw new Error("connection_lost");
    }
    return { created: !existing };
  }

  async findStatusByIdempotencyKey(idempotencyKey: string) {
    return this.events.has(idempotencyKey)
      ? { id: `event:${idempotencyKey}` }
      : null;
  }
}

describe("SdkGrowthPublicationOutboxBridge", () => {
  it("deduplicates a lost enqueue acknowledgement and links the one event", async () => {
    const handoffs = new FakeHandoffs();
    const outbox = new FakeOutbox();
    const publication = fixture();
    handoffs.seeds.set(publication.intentId, publication);
    outbox.loseAcknowledgement = true;
    const bridge = new SdkGrowthPublicationOutboxBridge(handoffs, outbox);

    await expect(bridge.enqueue(publication)).rejects.toThrow(
      "connection_lost",
    );
    await expect(bridge.enqueue(publication)).resolves.toBe("linked");
    await expect(bridge.enqueue(publication)).resolves.toBe("already-linked");
    expect(outbox.events).toHaveLength(1);
    expect(handoffs.links.get(publication.intentId)).toBe(
      `event:${publication.intentId}`,
    );
  });

  it("supports the worker-before-link race without changing the envelope", async () => {
    const handoffs = new FakeHandoffs();
    const outbox = new FakeOutbox();
    const publication = fixture();
    handoffs.seeds.set(publication.intentId, publication);
    const bridge = new SdkGrowthPublicationOutboxBridge(handoffs, outbox);
    await outbox.enqueue({
      type: "sdk_growth.publication_requested",
      version: 1,
      idempotencyKey: publication.intentId,
      workspaceId: null,
      repositoryId: null,
      aggregateId: publication.intentId,
      payload: {
        intentId: publication.intentId,
        envelopeDigest: publication.envelopeDigest,
      },
      maxAttempts: 20,
      occurredAt: new Date(publication.createdAt),
    });

    await expect(
      bridge.linkClaimedEvent({
        id: `event:${publication.intentId}`,
        type: "sdk_growth.publication_requested",
        version: 1,
        idempotencyKey: publication.intentId,
        payload: {
          intentId: publication.intentId,
          envelopeDigest: publication.envelopeDigest,
        },
      }),
    ).resolves.toBe("linked");
  });

  it("rejects conflicting payloads and maps no untrusted workspace", async () => {
    const handoffs = new FakeHandoffs();
    const outbox = new FakeOutbox();
    const publication = fixture();
    handoffs.seeds.set(publication.intentId, publication);
    const bridge = new SdkGrowthPublicationOutboxBridge(handoffs, outbox);

    await bridge.enqueue(publication);
    expect(outbox.events.get(publication.intentId)).toMatchObject({
      workspaceId: null,
      repositoryId: null,
      payload: { envelopeDigest: publication.envelopeDigest },
    });
    await expect(
      bridge.linkClaimedEvent({
        id: "event-elsewhere",
        type: "sdk_growth.publication_requested",
        version: 1,
        idempotencyKey: publication.intentId,
        payload: {
          intentId: publication.intentId,
          envelopeDigest: "f".repeat(64),
        },
      }),
    ).rejects.toThrow("sdk_growth_outbox_envelope_conflict");
  });
});

function fixture() {
  return buildPublicationSeed({
    intentId: "intent-outbox",
    authority: {
      tenantId: "tenant",
      repositoryId: "authority-repository",
      pullRequest: 1,
      receiptFence: 1n,
      authorityEpoch: 1n,
      receiptDigest: "a".repeat(64),
    },
    repositoryId: "1",
    installationId: "2",
    appId: "3",
    repositoryFullName: "owner/repo",
    headSha: "b".repeat(40),
    admitted: true,
    output: { title: "title", summary: "summary" },
    createdAt: 1_700_000_000_000,
  });
}
