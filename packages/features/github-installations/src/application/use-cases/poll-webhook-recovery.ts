import { setTimeout as delay } from "node:timers/promises";
import type { WebhookRecoveryIdentity } from "../ports/webhook-recovery-identity";

export type WebhookAttemptObservation = Readonly<{
  state: "observed" | "not_observed" | "incomplete" | "rate_limited";
  pages: number;
  matchingAttempts: number;
}>;
export interface WebhookRecoveryObservationClient {
  readonly appIdentityHash: string;
  scanAttempts(
    identity: WebhookRecoveryIdentity,
    maxPages: number,
    signal?: AbortSignal,
  ): Promise<WebhookAttemptObservation>;
}
export interface WebhookRecoveryConfirmation {
  confirm(identity: WebhookRecoveryIdentity): Promise<boolean>;
}
export type WebhookRecoveryPollOutcome = Readonly<{
  state: "confirmed" | "pending" | "incomplete" | "rate_limited" | "cancelled";
  polls: number;
  observedAttempts: number;
}>;

/** Bounded explicit reconciliation; only an exact receiver terminal proves success. */
export async function pollWebhookRecovery(
  identity: WebhookRecoveryIdentity,
  dependencies: Readonly<{
    client: WebhookRecoveryObservationClient;
    custody: WebhookRecoveryConfirmation;
  }>,
  options: Readonly<{
    maxPolls: number;
    maxPages: number;
    delayMs: number;
    signal?: AbortSignal;
  }>,
): Promise<WebhookRecoveryPollOutcome> {
  if (
    identity.appIdentityHash !== dependencies.client.appIdentityHash ||
    !Number.isInteger(options.maxPolls) ||
    options.maxPolls < 1 ||
    options.maxPolls > 3 ||
    !Number.isInteger(options.maxPages) ||
    options.maxPages < 1 ||
    options.maxPages > 5 ||
    !Number.isInteger(options.delayMs) ||
    options.delayMs < 0 ||
    options.delayMs > 30_000
  )
    throw new Error("webhook_recovery_poll_invalid");
  let polls = 0,
    observedAttempts = 0;
  for (; polls < options.maxPolls; ) {
    if (options.signal?.aborted)
      return { state: "cancelled", polls, observedAttempts };
    try {
      if (await dependencies.custody.confirm(identity))
        return { state: "confirmed", polls, observedAttempts };
    } catch {
      return {
        state: options.signal?.aborted ? "cancelled" : "incomplete",
        polls,
        observedAttempts,
      };
    }
    if (options.signal?.aborted)
      return { state: "cancelled", polls, observedAttempts };
    let observation: WebhookAttemptObservation;
    try {
      observation = await dependencies.client.scanAttempts(
        identity,
        options.maxPages,
        options.signal,
      );
    } catch {
      return {
        state: options.signal?.aborted ? "cancelled" : "incomplete",
        polls,
        observedAttempts,
      };
    }
    polls++;
    observedAttempts = Math.max(observedAttempts, observation.matchingAttempts);
    if (options.signal?.aborted)
      return { state: "cancelled", polls, observedAttempts };
    try {
      if (await dependencies.custody.confirm(identity))
        return { state: "confirmed", polls, observedAttempts };
    } catch {
      return {
        state: options.signal?.aborted ? "cancelled" : "incomplete",
        polls,
        observedAttempts,
      };
    }
    if (options.signal?.aborted)
      return { state: "cancelled", polls, observedAttempts };
    if (
      observation.state === "incomplete" ||
      observation.state === "rate_limited"
    )
      return { state: observation.state, polls, observedAttempts };
    if (polls < options.maxPolls && options.delayMs > 0) {
      try {
        await delay(
          options.delayMs,
          undefined,
          options.signal ? { signal: options.signal } : {},
        );
      } catch {
        return { state: "cancelled", polls, observedAttempts };
      }
    }
  }
  return { state: "pending", polls, observedAttempts };
}
