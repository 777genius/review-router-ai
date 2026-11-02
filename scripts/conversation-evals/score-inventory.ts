import { createHash } from "node:crypto";
import type { Witness } from "./fixture.js";
import type { CorpusEvent, TargetBinding } from "./corpus.js";
import {
  conversationActionConfirmation,
  conversationDigest,
} from "../../packages/features/conversations/src/index.js";
import {
  automaticMemoryChildCommandId,
  memoryKnowledgeDigest,
} from "../../packages/features/memory/src/index.js";

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
  automaticLearningEligible: boolean;
  revision: string;
  threadId: string;
  messageId: string;
  headSha: string;
  body?: string;
  scope?: Witness["inventory"][number]["scope"];
  maintainer?: boolean;
  requireConfirmation?: boolean;
  settingsRevision?: string;
};
export const sourceRevision = (updatedAt: string, body: string) =>
  `${updatedAt}:${createHash("sha256").update(body, "utf8").digest("hex")}`;
const scopeKey = (scope: Witness["inventory"][number]["scope"]) =>
  JSON.stringify([
    scope.kind,
    scope.workspaceId,
    "repositoryId" in scope ? scope.repositoryId : null,
  ]);

export function inspectCommandInventory(
  witness: Pick<Witness, "commandInventoryIds" | "effectIds" | "effects">,
  seen: Set<string>,
) {
  if (
    !Array.isArray(witness.commandInventoryIds) ||
    !Array.isArray(witness.effectIds) ||
    !Array.isArray(witness.effects)
  )
    throw new Error("eval_complete_command_inventory_required");
  const current = new Set(witness.commandInventoryIds);
  const returned = new Set(witness.effectIds);
  const expected = new Set(
    [...current].filter((id) => !seen.has(id)).concat([...returned]),
  );
  if (
    current.size !== witness.commandInventoryIds.length ||
    returned.size !== witness.effectIds.length ||
    [...seen].some((id) => !current.has(id)) ||
    [...returned].some((id) => !current.has(id)) ||
    witness.effects.length !== expected.size ||
    new Set(witness.effects.map((effect) => effect.id)).size !==
      expected.size ||
    witness.effects.some((effect) => !expected.has(effect.id))
  )
    throw new Error("eval_effect_inventory_invalid");
  const newIds = new Set([...current].filter((id) => !seen.has(id)));
  for (const id of current) seen.add(id);
  return newIds;
}

export const qualifiedReadback = (
  entry: Witness["inventory"][number],
): entry is Witness["inventory"][number] & {
  body: string;
  bodyDigest: string;
} =>
  entry.body !== null &&
  entry.bodyDigest !== null &&
  entry.lifecycle === "active" &&
  entry.unavailableReason === null &&
  (entry.activeCohortEligible === true ||
    Boolean(
      entry.explicitCommandId &&
      entry.approvalAuthorityRevision?.startsWith("github-command:v2:"),
    )) &&
  entry.sourceCurrent === true;

/** Verify the actual owning command fingerprint; rubric labels cannot authorize a command. */
export function inspectExplicitEffect(
  effect: Witness["effects"][number],
  source: SourceWitness | undefined,
  processingId: string,
) {
  const proof = effect.explicitAction;
  if (
    !proof ||
    !source?.maintainer ||
    source.body === undefined ||
    !source.scope ||
    source.requireConfirmation !== proof.requireConfirmation ||
    source.settingsRevision !== proof.settingsRevision ||
    effect.actorId !== source.actorId ||
    proof.actor.kind !== "github_user" ||
    proof.actor.id !== source.actorId ||
    proof.actor.githubUserId !== source.actorId.replace("github-user:", "") ||
    effect.sourceId !== proof.source.sourceId ||
    effect.sourceRevision !== source.revision ||
    proof.source.revision !== source.revision ||
    proof.source.repositoryId !==
      ("repositoryId" in source.scope ? source.scope.repositoryId : null) ||
    proof.source.claimedBodyDigest !==
      createHash("sha256").update(source.body).digest("hex") ||
    scopeKey(effect.scope) !== scopeKey(source.scope)
  )
    throw new Error("eval_explicit_command_authority_invalid");
  const action = proof.action;
  const digest = conversationDigest([
    "conversation-explicit-command",
    processingId,
  ]);
  const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  const target =
    action.kind === "create" ? `mem_${id.replaceAll("-", "")}` : action.entryId;
  const expectedKind =
    action.kind === "create" || action.kind === "update" ? "save" : action.kind;
  const expectedRevision =
    action.kind === "create" ? null : action.expectedRevision;
  const expectedAuthority = `github-command:v2:${expectedRevision ?? "new"}:${memoryKnowledgeDigest(
    {
      wire: action,
      ref: { type: "entry", scope: effect.scope, entryId: target },
      source: proof.source,
      actor: {
        kind: proof.actor.kind,
        id: proof.actor.id,
        githubUserId: proof.actor.githubUserId,
      },
    },
  )}`;
  const normalize = (body: string) => body.replaceAll("\r\n", "\n").trim();
  if (
    effect.id !== id ||
    effect.entryId !== target ||
    effect.kind !== expectedKind ||
    effect.approvalAuthorityRevision !== expectedAuthority ||
    (proof.requireConfirmation &&
      !(["en", "ru"] as const).some(
        (language) =>
          normalize(source.body!) ===
          normalize(conversationActionConfirmation(action, language)),
      ))
  )
    throw new Error("eval_explicit_command_authority_invalid");
}

/** A correct fact is insufficient permission to turn a factual endorsement into maintained CRUD. */
export function inspectExpectedEffects(
  witness: Witness,
  expected: NonNullable<CorpusEvent["expectedEffects"]>,
  targets: Readonly<Record<string, TargetBinding>>,
) {
  const effects = witness.effects.filter((effect) => effect.explicitAction);
  const matches = (
    effect: Witness["effects"][number],
    requested: (typeof expected)[number],
  ) => {
    const target = requested.targetAlias
      ? targets[requested.targetAlias]
      : undefined;
    if (requested.targetAlias && !target)
      throw new Error("eval_target_binding_missing");
    const action = effect.explicitAction!.action;
    const kind =
      requested.kind === "save"
        ? target
          ? "update"
          : "create"
        : requested.kind;
    return (
      effect.kind === requested.kind &&
      action.kind === kind &&
      (action.kind !== "create" || action.knowledgeKind === "observation") &&
      (!target ||
        (effect.entryId === target.entryId &&
          action.kind !== "create" &&
          action.expectedRevision === target.revision))
    );
  };
  return {
    unexpected: effects.filter(
      (effect) => !expected.some((requested) => matches(effect, requested)),
    ).length,
    missing: expected.filter(
      (requested) =>
        !effects.some((effect) => {
          if (!matches(effect, requested)) return false;
          const entry = witness.inventory.find(
            (row) => row.id === effect.entryId,
          );
          const action = effect.explicitAction!.action;
          return requested.kind === "save"
            ? Boolean(
                entry &&
                qualifiedReadback(entry) &&
                (action.kind === "create" || action.kind === "update") &&
                entry.body === action.body,
              )
            : Boolean(
                entry && entry.body === null && entry.lifecycle !== "active",
              );
        }),
    ).length,
  };
}

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
  seenCommands: Set<string>;
  revokedEntryIds?: ReadonlySet<string>;
  allowExplicit?: boolean;
  knownScopes?: readonly Witness["inventory"][number]["scope"][];
  explicitProofs?: Map<string, Witness["effects"][number]>;
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
  const newCommandIds = inspectCommandInventory(witness, input.seenCommands);
  const explicitProofs =
    input.explicitProofs ?? new Map<string, Witness["effects"][number]>();
  const knownScopeKeys = new Set(
    (input.knownScopes ?? [input.scope]).map(scopeKey),
  );
  for (const effect of witness.effects) {
    const selected = input.sources.get(input.triggerSourceId);
    const prior = input.seenEntries.get(effect.entryId);
    const historical = input.sourceHistory.get(
      `${effect.sourceId}\u0000${effect.sourceRevision}`,
    );
    const authorizedSource = newCommandIds.has(effect.id)
      ? selected
      : historical;
    const retirement = effect.automaticRetirement;
    if (input.allowExplicit && effect.explicitAction) {
      const previous = explicitProofs.get(effect.id);
      if (
        previous &&
        JSON.stringify({ ...previous, state: effect.state }) !==
          JSON.stringify(effect)
      )
        throw new Error("eval_explicit_command_authority_changed");
      if (!previous)
        inspectExplicitEffect(effect, selected, witness.processingId);
      if (
        !knownScopeKeys.has(scopeKey(effect.scope)) ||
        !witness.effectIds.includes(effect.id) ||
        !witness.inventory.some((entry) => entry.id === effect.entryId)
      )
        throw new Error("eval_explicit_command_inventory_invalid");
      explicitProofs.set(effect.id, structuredClone(effect));
      continue;
    }
    const digest =
      prior &&
      retirement &&
      memoryKnowledgeDigest([
        "automatic-retirement",
        retirement?.generation,
        { type: "entry", scope: input.scope, entryId: effect.entryId },
        prior.automaticCohortId,
      ]);
    const recoveryId =
      digest &&
      `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    const validRetirement =
      effect.kind === "retire" &&
      prior &&
      historical &&
      historical.automaticLearningEligible === true &&
      retirement &&
      effect.sourceId === prior.sourceId &&
      effect.sourceRevision === prior.sourceRevision &&
      effect.actorId === historical.actorId &&
      effect.actorId === prior.sourceActor &&
      retirement.ownership === "automatic" &&
      retirement.cohortId === prior.automaticCohortId &&
      retirement.epoch === prior.automaticCohortEpoch &&
      !retirement.suppressed &&
      (retirement.currentCohortId !== retirement.cohortId ||
        (retirement.currentState === "needs_refresh" &&
          ["changed", "deleted"].includes(retirement.invalidatedBy ?? ""))) &&
      (effect.id ===
        automaticMemoryChildCommandId(witness.processingId, effect.entryId) ||
        effect.id === recoveryId);
    if (
      scopeKey(effect.scope) !== scopeKey(selected?.scope ?? input.scope) ||
      !effect.approvalAuthorityRevision.startsWith("automatic:") ||
      (effect.kind === "save"
        ? authorizedSource?.automaticLearningEligible !== true ||
          !witness.effectIds.includes(effect.id) ||
          effect.actorId !== authorizedSource?.actorId ||
          effect.sourceId !== input.triggerSourceId ||
          effect.sourceRevision !== authorizedSource?.revision
        : !validRetirement) ||
      !witness.inventory.some((entry) => entry.id === effect.entryId)
    )
      throw new Error("eval_observed_effect_authority_invalid");
  }
  const versions: {
    key: string;
    annotation: EntryReview;
    source: SourceWitness;
    entry: Witness["inventory"][number];
    qualifiedReadback: boolean;
  }[] = [];
  for (const entry of witness.inventory) {
    if (
      ![
        null,
        "unsettled",
        "provider_unavailable",
        "incomplete_evidence",
      ].includes(entry.unavailableReason) ||
      typeof entry.activeCohortEligible !== "boolean" ||
      typeof entry.sourceCurrent !== "boolean" ||
      (entry.body !== null && entry.unavailableReason !== null)
    )
      throw new Error("eval_readback_qualification_required");
    const prior = input.seenEntries.get(entry.id);
    const explicit =
      input.allowExplicit && entry.explicitCommandId
        ? explicitProofs.get(entry.explicitCommandId)
        : undefined;
    const forgotten =
      input.allowExplicit &&
      entry.lifecycle === "forgotten" &&
      entry.body === null &&
      entry.bodyDigest === null &&
      prior &&
      [...explicitProofs.values()].some(
        (effect) =>
          effect.kind === "forget" &&
          effect.entryId === entry.id &&
          scopeKey(effect.scope) === scopeKey(entry.scope),
      );
    if (forgotten) {
      input.seenEntries.set(entry.id, { ...entry });
      continue;
    }
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
    const explicitSource =
      explicit?.sourceId && explicit.sourceRevision
        ? input.sourceHistory.get(
            `${explicit.sourceId}\u0000${explicit.sourceRevision}`,
          )
        : undefined;
    const explicitValid =
      explicit &&
      explicitSource &&
      explicit.entryId === entry.id &&
      explicit.approvalAuthorityRevision === entry.approvalAuthorityRevision &&
      knownScopeKeys.has(scopeKey(entry.scope)) &&
      scopeKey(explicit.scope) === scopeKey(entry.scope) &&
      entry.kind ===
        (explicit.explicitAction?.action.kind === "create"
          ? explicit.explicitAction.action.knowledgeKind
          : (prior?.kind ?? entry.kind)) &&
      (entry.body === null ||
        (entry.sourceId === explicit.sourceId &&
          entry.sourceRevision === explicit.sourceRevision &&
          entry.sourceActor === explicit.actorId)) &&
      (!prior ||
        prior.explicitCommandId === entry.explicitCommandId ||
        (explicit.explicitAction?.action.kind !== "create" &&
          explicit.explicitAction?.action.expectedRevision === prior.revision));
    if (
      !explicitValid &&
      ((prior &&
        (prior.sourceId !== entry.sourceId ||
          prior.sourceActor !== entry.sourceActor ||
          prior.kind !== entry.kind ||
          prior.automaticCohortId !== entry.automaticCohortId ||
          prior.automaticCohortEpoch !== entry.automaticCohortEpoch)) ||
        !entry.id ||
        !entry.revision ||
        !knownScopeKeys.has(scopeKey(entry.scope)) ||
        (historical?.scope !== undefined &&
          scopeKey(entry.scope) !== scopeKey(historical.scope)) ||
        !historical ||
        (entry.approvalAuthorityRevision?.startsWith("automatic:") &&
          historical?.automaticLearningEligible !== true) ||
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
          (!current || current.revision !== entry.sourceRevision)))
    )
      throw new Error("eval_observed_entry_authority_invalid");
    if (
      entry.body !== null &&
      createHash("sha256").update(entry.body, "utf8").digest("hex") !==
        entry.bodyDigest
    )
      throw new Error("eval_current_readback_digest_invalid");
    if (
      explicitValid &&
      prior &&
      entry.body === null &&
      ["retire", "forget"].includes(explicit.kind) &&
      entry.bodyDigest === prior.bodyDigest
    ) {
      input.seenEntries.set(entry.id, { ...entry });
      continue;
    }
    // Revision plus the complete authority envelope prevents same-ID or same-body changes disappearing.
    const key = `${input.namespace}:${JSON.stringify(entry)}`;
    if (input.seen.has(key)) continue;
    if (
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
      source: explicitValid ? explicitSource : historical!,
      entry,
      qualifiedReadback: qualifiedReadback(entry),
    });
  }
  for (const entry of witness.retained) {
    if (
      !qualifiedReadback(entry) ||
      !witness.inventory.some(
        (row) => JSON.stringify(row) === JSON.stringify(entry),
      )
    )
      throw new Error("eval_retained_inventory_mismatch");
  }
  if (
    witness.inventory.filter(qualifiedReadback).length !==
    witness.retained.length
  )
    throw new Error("eval_retained_inventory_mismatch");
  return versions;
}
