import type { UsagePriceSnapshot } from "../domain/usage-price";
export type { UsagePriceSnapshot } from "../domain/usage-price";
import type { UsagePeriodReport } from "./report-usage";
import type { UsageFact, UsageProjection } from "../domain/usage";
export interface UsageIngestContext {
  /** Trusted grant issuance bound; never a producer payload field. */
  originalEventNotBefore?: Date;
  serverPriceSnapshot?: UsagePriceSnapshot | null;
  /** Set only by trusted server authorization, never taken from the report payload. */
  workspaceId: string;
  invocationId: string;
  source: "runner" | "native";
  replayUntil: Date;
  now: Date;
}
export interface UsageIngestResult {
  status: "accepted" | "duplicate";
  hash: string;
}
export interface UsageStore {
  ingest(
    fact: UsageFact,
    context: UsageIngestContext,
  ): Promise<UsageIngestResult>;
}
export interface UsageReportQuery {
  workspaceId: string;
  actorId: string | null;
  access: "admin" | "member";
  from: Date;
  to: Date;
  route?: "gateway" | "direct";
  bindingId?: string;
  runId?: string;
  purpose?: "review" | "diagnostic";
  provider?: string;
  model?: string;
  runAfter?: string;
  limit?: number;
  after?: string;
}
export interface UsageReportReader {
  read(query: UsageReportQuery): Promise<readonly UsageProjection[]>;
  report(query: UsageReportQuery): Promise<UsagePeriodReport>;
}
export interface UsageSourcePage {
  facts: readonly UsageFact[];
  cursor: string;
  highWaterMark: string;
  complete: boolean;
}
export interface UsageSourceReader {
  listUsage(input: {
    afterCursor: string | null;
    limit: number;
    highWaterMark: string | null;
  }): Promise<UsageSourcePage>;
}
export interface UsagePriceSnapshotReader {
  read(input: {
    provider: string;
    model: string;
    occurredAt: string;
    tier: string | null;
  }): Promise<UsagePriceSnapshot | null>;
}

export function validateReportQuery(q: UsageReportQuery): void {
  const duration = q.to.getTime() - q.from.getTime();
  if (
    !q.workspaceId ||
    [q.provider, q.model, q.runAfter].some(
      (id) =>
        id !== undefined &&
        (!id.length ||
          id.length > 256 ||
          [...id].some((character) => {
            const code = character.charCodeAt(0);
            return code < 32 || (code >= 127 && code <= 159);
          })),
    ) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 366 * 86400000 ||
    (q.access === "member" && !q.actorId) ||
    (q.limit !== undefined &&
      (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 100))
  )
    throw new Error("usage_invalid_report_query");
}
export interface UsageAttributionReader {
  readDispatchSnapshot(input: {
    workspaceId: string;
    callId: string;
  }): Promise<{
    priceSnapshot: import("../domain/usage-price").UsagePriceSnapshot | null;
    serviceTier: string | null;
  } | null>;
  findIdentity(input: {
    workspaceId: string;
    callId: string;
  }): Promise<import("../domain/usage").UsageIdentity | null>;
}
