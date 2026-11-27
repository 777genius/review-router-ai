import { canonicalJson, type UsageFact } from "./usage";
import { estimateUsageCost } from "./estimate-usage-cost";

const carriesV2Evidence = (fact: UsageFact) => fact.nativeEvidenceVersion === 2;

function legacyProjection(fact: UsageFact): UsageFact {
  const {
    nativeContext: _context,
    nativeEvidenceVersion: _version,
    ...common
  } = fact;
  void _context;
  void _version;
  return {
    ...common,
    cost: estimateUsageCost({
      snapshot: fact.priceSnapshot ?? null,
      tokens: fact.tokens,
      provider: fact.actualProvider,
      model: fact.actualModel,
      tier: fact.serviceTier ?? null,
      occurredAt: fact.identity.occurredAt,
    }),
  };
}

/**
 * A wire-version replay cannot enrich or downgrade an already written event.
 * Only exact legacy common facts may duplicate across versions. Two v2 facts
 * still require their full hash to match, including actual billing and cost.
 */
export function matchesNativeUsageProjectionReplay(
  stored: UsageFact | undefined,
  incoming: UsageFact,
): boolean {
  if (
    !stored ||
    stored.authority !== "native" ||
    incoming.authority !== "native" ||
    stored.identity.route !== "gateway" ||
    incoming.identity.route !== "gateway" ||
    carriesV2Evidence(stored) === carriesV2Evidence(incoming)
  )
    return false;
  const older = carriesV2Evidence(stored) ? incoming : stored;
  const newer = carriesV2Evidence(stored) ? stored : incoming;
  return canonicalJson(older) === canonicalJson(legacyProjection(newer));
}
