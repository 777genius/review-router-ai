import { UsageError, validateUsageFact, type UsageFact } from "../domain/usage";
import type { UsageIngestContext, UsageStore } from "./ports";
export class IngestUsage {
  constructor(private readonly store: UsageStore) {}
  execute(fact: UsageFact, context: UsageIngestContext) {
    validateUsageFact(fact);
    if (
      !Number.isFinite(context.now.getTime()) ||
      !Number.isFinite(context.replayUntil.getTime()) ||
      (context.originalEventNotBefore !== undefined &&
        !Number.isFinite(context.originalEventNotBefore.getTime())) ||
      Date.parse(fact.identity.occurredAt) > context.now.getTime() + 300000
    )
      throw new UsageError("usage_invalid_fact");
    if (
      (context.source === "runner" &&
        !(["runtime", "runner"] as const).includes(
          fact.authority as "runtime" | "runner",
        )) ||
      (context.source === "native" &&
        !["native", "lifecycle"].includes(fact.authority))
    )
      throw new UsageError("usage_authority_conflict");
    if (
      fact.identity.workspaceId !== context.workspaceId ||
      fact.identity.invocationId !== context.invocationId
    )
      throw new UsageError("usage_identity_conflict");
    const occurredAt = Date.parse(fact.identity.occurredAt);
    const expiredOriginal =
      context.source === "runner" &&
      context.originalEventNotBefore !== undefined
        ? occurredAt < context.originalEventNotBefore.getTime() - 300000
        : context.now.getTime() - occurredAt >
          (context.source === "runner" ? 7 : 30) * 86400000;
    if (context.now > context.replayUntil || expiredOriginal)
      throw new UsageError(
        context.source === "runner"
          ? "usage_report_expired"
          : "source_window_expired",
      );
    return this.store.ingest(fact, context);
  }
}
