import type {
  Digest,
  PublicationHandoffStore,
  PublicationSeed,
} from "../../application/publication-ports.js";
import { validatePublicationSeed } from "../../application/publication.js";

export const SDK_GROWTH_PUBLICATION_EVENT_TYPE =
  "sdk_growth.publication_requested" as const;
export const SDK_GROWTH_PUBLICATION_EVENT_VERSION = 1 as const;

export type PublicationOutboxEvent = Readonly<{
  id: string;
  type: string;
  version: number;
  idempotencyKey: string;
  payload: unknown;
}>;

export interface PublicationOutboxPort {
  enqueue(
    event: Readonly<{
      type: typeof SDK_GROWTH_PUBLICATION_EVENT_TYPE;
      version: typeof SDK_GROWTH_PUBLICATION_EVENT_VERSION;
      idempotencyKey: string;
      workspaceId: string | null;
      repositoryId: null;
      aggregateId: string;
      payload: Readonly<{ intentId: string; envelopeDigest: Digest }>;
      maxAttempts: 20;
      occurredAt: Date;
    }>,
  ): Promise<{ readonly created: boolean }>;
  findStatusByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<Readonly<{ id: string }> | null>;
}

export type TrustedWorkspaceResolver = (
  tenantId: string,
) => Promise<string | null>;

/**
 * Bridges immutable effect handoffs to the existing outbox contract. Enqueue is
 * idempotent on intentId; linking is write-once and can safely be repeated
 * after a lost acknowledgement.
 */
export class SdkGrowthPublicationOutboxBridge {
  constructor(
    private readonly handoffs: PublicationHandoffStore,
    private readonly outbox: PublicationOutboxPort,
    private readonly trustedWorkspace: TrustedWorkspaceResolver = async () =>
      null,
  ) {}

  async enqueue(seed: PublicationSeed): Promise<"linked" | "already-linked"> {
    const immutable = validatePublicationSeed(seed);
    const workspaceId = await this.trustedWorkspace(
      immutable.authority.tenantId,
    );
    await this.outbox.enqueue({
      type: SDK_GROWTH_PUBLICATION_EVENT_TYPE,
      version: SDK_GROWTH_PUBLICATION_EVENT_VERSION,
      idempotencyKey: immutable.intentId,
      workspaceId,
      repositoryId: null,
      aggregateId: immutable.intentId,
      payload: {
        intentId: immutable.intentId,
        envelopeDigest: immutable.envelopeDigest,
      },
      maxAttempts: 20,
      occurredAt: new Date(immutable.createdAt),
    });
    const event = await this.outbox.findStatusByIdempotencyKey(
      immutable.intentId,
    );
    if (!event) throw new Error("sdk_growth_outbox_event_unavailable");
    const linked = await this.handoffs.link(
      immutable.intentId,
      immutable.envelopeDigest,
      event.id,
    );
    if (linked === "conflict") {
      throw new Error("sdk_growth_outbox_link_conflict");
    }
    return linked;
  }

  async recover(limit: number): Promise<
    Readonly<{
      linked: number;
      failed: number;
    }>
  > {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 1_000) {
      throw new Error("sdk_growth_recovery_limit_invalid");
    }
    const seeds = await this.handoffs.listUnqueued(limit);
    let linked = 0;
    let failed = 0;
    for (const seed of seeds) {
      try {
        await this.enqueue(seed);
        linked += 1;
      } catch {
        failed += 1;
      }
    }
    return Object.freeze({ linked, failed });
  }

  /**
   * Allows a claimed worker to win the enqueue-to-link race. The production
   * effect store will additionally verify the whole event under its claim lock.
   */
  async linkClaimedEvent(
    event: PublicationOutboxEvent,
  ): Promise<"linked" | "already-linked"> {
    const payload = parsePayload(event);
    const seed = await this.handoffs.load(payload.intentId);
    if (
      !seed ||
      seed.envelopeDigest !== payload.envelopeDigest ||
      event.idempotencyKey !== payload.intentId
    ) {
      throw new Error("sdk_growth_outbox_envelope_conflict");
    }
    const result = await this.handoffs.link(
      payload.intentId,
      payload.envelopeDigest,
      event.id,
    );
    if (result === "conflict") {
      throw new Error("sdk_growth_outbox_link_conflict");
    }
    return result;
  }
}

export function parseSdkGrowthPublicationEvent(
  event: PublicationOutboxEvent,
): Readonly<{ intentId: string; envelopeDigest: Digest }> {
  return parsePayload(event);
}

function parsePayload(
  event: PublicationOutboxEvent,
): Readonly<{ intentId: string; envelopeDigest: Digest }> {
  if (
    event.type !== SDK_GROWTH_PUBLICATION_EVENT_TYPE ||
    event.version !== SDK_GROWTH_PUBLICATION_EVENT_VERSION ||
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new Error("sdk_growth_outbox_event_invalid");
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    Reflect.ownKeys(payload).length !== 2 ||
    typeof payload.intentId !== "string" ||
    payload.intentId.length === 0 ||
    typeof payload.envelopeDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payload.envelopeDigest)
  ) {
    throw new Error("sdk_growth_outbox_event_invalid");
  }
  return Object.freeze({
    intentId: payload.intentId,
    envelopeDigest: payload.envelopeDigest,
  });
}
