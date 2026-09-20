export const SDK_GROWTH_PUBLICATION_HANDLER = Object.freeze({
  type: "sdk_growth.publication_requested",
  version: 1,
});

export type SdkGrowthClaimedEvent = Readonly<{
  id: string;
  type: string;
  version: number;
  idempotencyKey: string;
  payload: unknown;
  claimId: string | null;
  claimVersion: bigint | null;
  claimOwnerHash: string | null;
}>;

export interface SdkGrowthPublicationApplicationPort {
  run(
    input: Readonly<{
      intentId: string;
      claim: Readonly<{
        eventId: string;
        claimId: string;
        claimVersion: bigint;
        claimOwnerHash: string;
      }>;
      signal: AbortSignal;
    }>,
  ): Promise<
    | "applied"
    | "not-applied"
    | "superseded"
    | "recovery-required"
    | "retry"
    | "stale-claim"
    | "missing"
  >;
}

export interface SdkGrowthPublicationLinkPort {
  linkClaimedEvent(
    event: SdkGrowthClaimedEvent,
  ): Promise<"linked" | "already-linked">;
  recover(limit: number): Promise<Readonly<{ linked: number; failed: number }>>;
}

/**
 * Disabled-by-default composition surface. Integration must explicitly add its
 * handler definition to the worker's available and known lists after Lane A
 * supplies the durable effect store.
 */
export class SdkGrowthPublicationRuntime {
  readonly handlerDefinition = SDK_GROWTH_PUBLICATION_HANDLER;

  constructor(
    private readonly application: SdkGrowthPublicationApplicationPort,
    private readonly links: SdkGrowthPublicationLinkPort,
  ) {}

  async handle(
    event: SdkGrowthClaimedEvent,
    signal: AbortSignal,
  ): Promise<void> {
    const parsed = parseClaimedEvent(event);
    let result: Awaited<ReturnType<SdkGrowthPublicationApplicationPort["run"]>>;
    try {
      await this.links.linkClaimedEvent(event);
      result = await this.application.run({
        intentId: parsed.intentId,
        claim: {
          eventId: event.id,
          claimId: event.claimId!,
          claimVersion: event.claimVersion!,
          claimOwnerHash: event.claimOwnerHash!,
        },
        signal,
      });
    } catch (error) {
      if (error instanceof SdkGrowthPublicationRuntimeError) throw error;
      throw new SdkGrowthPublicationRuntimeError("dependency-error", true, error);
    }
    if (
      result === "retry" ||
      result === "stale-claim" ||
      result === "missing"
    ) {
      throw new SdkGrowthPublicationRuntimeError(result, true);
    }
  }

  async recoverUnqueued(
    limit = 100,
  ): Promise<Readonly<{ linked: number; failed: number }>> {
    return this.links.recover(limit);
  }
}

export class SdkGrowthPublicationRuntimeError extends Error {
  readonly preserveReconciliation = true;
  constructor(
    readonly code: "retry" | "stale-claim" | "missing" | "dependency-error",
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(`sdk_growth_publication_${code}`);
    this.name = "SdkGrowthPublicationRuntimeError";
    if (cause !== undefined) this.cause = cause;
  }
}

export function parseClaimedEvent(
  event: SdkGrowthClaimedEvent,
): Readonly<{ intentId: string; envelopeDigest: string }> {
  if (
    event.type !== SDK_GROWTH_PUBLICATION_HANDLER.type ||
    event.version !== SDK_GROWTH_PUBLICATION_HANDLER.version ||
    !event.id ||
    !event.claimId ||
    typeof event.claimVersion !== "bigint" ||
    event.claimVersion <= 0n ||
    !event.claimOwnerHash ||
    event.payload === null ||
    typeof event.payload !== "object" ||
    Array.isArray(event.payload)
  ) {
    throw new Error("sdk_growth_claimed_event_invalid");
  }
  const payload = event.payload as Record<string, unknown>;
  if (
    Reflect.ownKeys(payload).length !== 2 ||
    typeof payload.intentId !== "string" ||
    payload.intentId.length === 0 ||
    payload.intentId !== event.idempotencyKey ||
    typeof payload.envelopeDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(payload.envelopeDigest)
  ) {
    throw new Error("sdk_growth_claimed_event_invalid");
  }
  return {
    intentId: payload.intentId,
    envelopeDigest: payload.envelopeDigest,
  };
}
