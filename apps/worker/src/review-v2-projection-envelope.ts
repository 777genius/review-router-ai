import { createHash } from "node:crypto";
import {
  validateReviewPublicationLifecycleVerification,
  type ReviewPublicationLifecycleVerificationFact,
  type ReviewPublicationOccurrenceCounts,
  type ReviewPrDescriptionSource,
} from "@reviewrouter/features-review-publishing/v2";
import {
  LineageHintEvictionReason,
  LineageHintState,
  SnapshotOccurrenceState,
  type LineageHintIndex,
  type OccurrenceProvenanceDto,
} from "@reviewrouter/features-review-snapshots/v2";

export type ProjectionEnvelope = {
  readonly envelopeVersion: "review_projection.v1";
  readonly lifecycleStateHash: string;
  readonly commandLedgerWatermark: string;
  readonly occurrences: readonly ProjectionOccurrence[];
  readonly publishing: {
    readonly prDescription?: ReviewPrDescriptionSource;
    readonly summary: {
      readonly marker: string;
      readonly body: string;
      readonly allClear: boolean;
      readonly occurrenceCounts: ReviewPublicationOccurrenceCounts;
    };
    readonly check: {
      readonly marker: string;
      readonly name: string;
      readonly title: string;
      readonly summary: string;
      readonly conclusion: "success" | "failure" | "neutral";
    };
    readonly inlineReviewChunks: readonly {
      readonly chunkIndex: number;
      readonly marker: string;
      readonly comments: readonly {
        readonly marker: string;
        readonly path: string;
        readonly startLine?: number;
        readonly line: number;
        readonly body: string;
      }[];
    }[];
    readonly lifecycle: readonly {
      readonly targetId: string;
      readonly threadId: string;
      readonly verdict: string;
      readonly mutationEligible: boolean;
      readonly verification?: ReviewPublicationLifecycleVerificationFact;
    }[];
  };
  readonly snapshot: {
    readonly lineageHints: readonly {
      readonly lineageId: string;
      readonly active: boolean;
      readonly [key: string]: unknown;
    }[];
  };
};

type ProjectionOccurrence = {
  readonly lineageId: string;
  readonly state: keyof typeof occurrenceStateMap;
  readonly observationIds: readonly string[];
  readonly providerVoteKeys: readonly string[];
  readonly placement: { readonly kind: string };
};

const occurrenceStateMap = {
  new: SnapshotOccurrenceState.New,
  reconfirmed: SnapshotOccurrenceState.Reconfirmed,
  changed: SnapshotOccurrenceState.Changed,
  carried_unverified: SnapshotOccurrenceState.CarriedUnverified,
  resolved: SnapshotOccurrenceState.Resolved,
  uncertain: SnapshotOccurrenceState.Uncertain,
  suppressed_by_human: SnapshotOccurrenceState.SuppressedByHuman,
} as const;

export function toOccurrence(value: ProjectionOccurrence): OccurrenceProvenanceDto {
  const state = occurrenceStateMap[value.state];
  if (!state) throw new Error("review_v2_projection_occurrence_state_invalid");
  return {
    lineageId: requireIdentifier(value.lineageId, "lineage_id_invalid"),
    state,
    observationIds: boundedIdentifiers(value.observationIds),
    freshProviderVoteKeys: boundedIdentifiers(value.providerVoteKeys),
    placementConfidence: value.placement.kind === "inline" ? 1 : 0,
  };
}

export function toLineageHints(
  projection: ProjectionEnvelope,
  createdAt: Date,
): LineageHintIndex {
  return {
    hints: projection.snapshot.lineageHints.map((hint) => ({
      lineageId: requireIdentifier(hint.lineageId, "lineage_id_invalid"),
      fingerprintHash: sha256(canonicalJson(hint)),
      state: hint.active ? LineageHintState.Active : LineageHintState.Resolved,
      lastSeenAt: new Date(createdAt),
    })),
    eviction: {
      [LineageHintEvictionReason.Age]: 0,
      [LineageHintEvictionReason.Count]: 0,
      [LineageHintEvictionReason.Bytes]: 0,
      evictionWatermark: null,
    },
  };
}

export function parseProjection(value: string): ProjectionEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("review_v2_projection_invalid_json");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== value) {
    throw new Error("review_v2_projection_not_canonical");
  }
  const publishing = parsed.publishing;
  const snapshot = parsed.snapshot;
  if (
    parsed.envelopeVersion !== "review_projection.v1" ||
    !Array.isArray(parsed.occurrences) ||
    !isRecord(publishing) ||
    !isRecord(publishing.summary) ||
    !isOccurrenceCounts(publishing.summary.occurrenceCounts) ||
    !isRecord(publishing.check) ||
    !Array.isArray(publishing.inlineReviewChunks) ||
    !Array.isArray(publishing.lifecycle) ||
    !isRecord(snapshot) ||
    !Array.isArray(snapshot.lineageHints)
  ) {
    throw new Error("review_v2_projection_shape_invalid");
  }
  for (const entry of publishing.lifecycle) {
    if (!isRecord(entry))
      throw new Error("review_v2_projection_lifecycle_invalid");
    if (entry.verification !== undefined)
      validateReviewPublicationLifecycleVerification(
        entry.verification,
        requireIdentifier(entry.targetId, "target_id_invalid"),
      );
  }
  return parsed as unknown as ProjectionEnvelope;
}

function isOccurrenceCounts(
  value: unknown,
): value is ReviewPublicationOccurrenceCounts {
  if (!isRecord(value)) return false;
  const keys = [
    "new",
    "reconfirmed",
    "changed",
    "carried_unverified",
    "resolved",
    "uncertain",
    "suppressed_by_human",
  ] as const;
  return (
    Object.keys(value).length === keys.length &&
    keys.every(
      (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
    ) &&
    Number.isSafeInteger(
      keys.reduce((sum, key) => sum + (value[key] as number), 0),
    )
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function requireIdentifier(value: unknown, code: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value.trim() !== value
  ) {
    throw new Error(code);
  }
  return value;
}

function boundedIdentifiers(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error("review_v2_projection_identifiers_invalid");
  }
  return value.map((entry) => requireIdentifier(entry, "identifier_invalid"));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
