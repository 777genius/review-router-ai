import { createHash } from "node:crypto";
import type { Witness } from "./fixture.js";

export type EntryReview = {
  variant: string;
  namespace: string;
  entryId: string;
  entryRevision: string;
  bodyDigest: string;
  supportedFactIds: string[];
  attributionCorrect: boolean;
  wrongScope: boolean;
};
export type SourceWitness = {
  actorId: string;
  revision: string;
  threadId: string;
  messageId: string;
  headSha: string;
};
export const sourceRevision = (updatedAt: string, body: string) =>
  `${updatedAt}:${createHash("sha256").update(body, "utf8").digest("hex")}`;
const scopeKey = (scope: Witness["inventory"][number]["scope"]) =>
  JSON.stringify([
    scope.kind,
    scope.workspaceId,
    "repositoryId" in scope ? scope.repositoryId : null,
  ]);

/** Validate the complete observed inventory before selecting event-attributed rows. */
export function inspectInventory(input: {
  namespace: string;
  scope: Witness["inventory"][number]["scope"];
  witness: Witness;
  sources: ReadonlyMap<string, SourceWitness>;
  sourceHistory: ReadonlyMap<string, SourceWitness>;
  triggerSourceId: string;
  eventAction?: string;
  entries: readonly EntryReview[];
  seen: Set<string>;
  seenEntries: Map<string, Witness["inventory"][number]>;
  revokedEntryIds?: ReadonlySet<string>;
}) {
  const { witness } = input;
  if (!Array.isArray(witness.inventory) || !Array.isArray(witness.effects))
    throw new Error("eval_complete_inventory_and_effect_proof_required");
  if (
    new Set(witness.inventory.map((entry) => entry.id)).size !==
    witness.inventory.length
  )
    throw new Error("eval_observed_entry_identity_invalid");
  if (
    [...input.seenEntries.keys()].some(
      (id) => !witness.inventory.some((entry) => entry.id === id),
    )
  )
    throw new Error("eval_observed_inventory_disappeared");
  const expectedEffects = new Set(witness.effectIds);
  if (
    expectedEffects.size !== witness.effectIds.length ||
    witness.effects.length !== expectedEffects.size ||
    new Set(witness.effects.map((effect) => effect.id)).size !==
      expectedEffects.size
  )
    throw new Error("eval_effect_inventory_invalid");
  for (const effect of witness.effects) {
    const selected = input.sources.get(input.triggerSourceId);
    if (
      !expectedEffects.has(effect.id) ||
      scopeKey(effect.scope) !== scopeKey(input.scope) ||
      !["save", "retire"].includes(effect.kind) ||
      effect.actorId !== selected?.actorId ||
      !effect.approvalAuthorityRevision.startsWith("automatic:") ||
      effect.sourceId !== input.triggerSourceId ||
      (effect.kind === "save"
        ? effect.sourceRevision !== selected?.revision
        : input.eventAction !== "edited" ||
          !input.sourceHistory.has(
            `${effect.sourceId}\u0000${effect.sourceRevision}`,
          )) ||
      !witness.inventory.some((entry) => entry.id === effect.entryId)
    )
      throw new Error("eval_observed_effect_authority_invalid");
  }
  const versions: {
    key: string;
    annotation: EntryReview;
    source: SourceWitness;
    entry: Witness["inventory"][number];
  }[] = [];
  for (const entry of witness.inventory) {
    const prior = input.seenEntries.get(entry.id);
    // Qualified full-forget may purge source/approval bytes; only a previously
    // validated identity with the matching actual owner mutation proof may do so.
    if (
      entry.lifecycle === "forgotten" &&
      entry.body === null &&
      entry.bodyDigest === null &&
      entry.sourceId === null &&
      entry.sourceRevision === null &&
      entry.approvalAuthorityRevision === null &&
      prior?.kind === "observation" &&
      prior.sourceActor === entry.sourceActor &&
      prior.automaticCohortId === entry.automaticCohortId &&
      prior.automaticCohortEpoch === entry.automaticCohortEpoch &&
      entry.kind === prior.kind &&
      input.revokedEntryIds?.has(entry.id) &&
      entry.revision &&
      scopeKey(entry.scope) === scopeKey(input.scope)
    ) {
      input.seen.add(`${input.namespace}:${JSON.stringify(entry)}`);
      continue;
    }
    const historical = input.sourceHistory.get(
      `${entry.sourceId}\u0000${entry.sourceRevision}`,
    );
    const current = entry.sourceId
      ? input.sources.get(entry.sourceId)
      : undefined;
    if (
      (prior &&
        (prior.sourceId !== entry.sourceId ||
          prior.sourceActor !== entry.sourceActor ||
          prior.kind !== entry.kind ||
          prior.automaticCohortId !== entry.automaticCohortId ||
          prior.automaticCohortEpoch !== entry.automaticCohortEpoch)) ||
      !entry.id ||
      !entry.revision ||
      scopeKey(entry.scope) !== scopeKey(input.scope) ||
      !historical ||
      entry.sourceActor !== historical.actorId ||
      entry.observedCommit !== historical.headSha ||
      entry.kind !== "observation" ||
      (!entry.approvalAuthorityRevision?.startsWith("automatic:") &&
        !(
          entry.body === null &&
          input.revokedEntryIds?.has(entry.id) &&
          entry.approvalAuthorityRevision ===
            "explicit-evaluation-owner-decision"
        )) ||
      !entry.automaticCohortId ||
      !entry.automaticCohortEpoch ||
      (entry.body !== null &&
        (!current || current.revision !== entry.sourceRevision))
    )
      throw new Error("eval_observed_entry_authority_invalid");
    if (
      entry.body !== null &&
      createHash("sha256").update(entry.body, "utf8").digest("hex") !==
        entry.bodyDigest
    )
      throw new Error("eval_current_readback_digest_invalid");
    // Revision plus the complete authority envelope prevents same-ID or same-body changes disappearing.
    const key = `${input.namespace}:${JSON.stringify(entry)}`;
    if (input.seen.has(key)) continue;
    if (
      entry.body !== null &&
      !input.seenEntries.has(entry.id) &&
      entry.sourceId !== input.triggerSourceId
    )
      throw new Error("eval_unexpected_new_source_write");
    input.seenEntries.set(entry.id, { ...entry, scope: { ...entry.scope } });
    input.seen.add(key);
    if (entry.bodyDigest === null) continue; // Purged tombstones have no statement to judge.
    const annotation = input.entries.filter(
      (row) =>
        row.variant === "full-product" &&
        row.namespace === input.namespace &&
        row.entryId === entry.id &&
        row.entryRevision === entry.revision &&
        row.bodyDigest === entry.bodyDigest,
    );
    if (annotation.length !== 1)
      throw new Error(
        `eval_missing_or_duplicate_entry_version_rubric:${entry.id}`,
      );
    versions.push({
      key,
      annotation: annotation[0]!,
      source: historical,
      entry,
    });
  }
  for (const entry of witness.retained) {
    if (
      entry.body === null ||
      !witness.inventory.some(
        (row) => JSON.stringify(row) === JSON.stringify(entry),
      )
    )
      throw new Error("eval_retained_inventory_mismatch");
  }
  if (
    witness.inventory.filter((entry) => entry.body !== null).length !==
    witness.retained.length
  )
    throw new Error("eval_retained_inventory_mismatch");
  return versions;
}
