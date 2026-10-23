// Operator recovery: clear a stuck worker-account capacity gate via the store API.
// This resets the local gate record only — it does not reset provider-side quota.
const base =
  process.env.BRIDGE_DIST ??
  "/opt/subscription-runtime/mimo-project-bridge-current/dist";
const { codexAccountCapacityStore } = await import(
  base + "/worker-codex/application/codex-account-capacity-store.js"
);
const {
  WorkerAccountCapacityClaimStatus,
  WorkerAccountCapacityRecheckMode,
  WorkerAccountCapacityResolutionType,
  WorkerAccountCapacityResolveStatus,
} = await import(
  base +
    "/worker-core/account-capacity/domain/worker-account-capacity-recheck.js"
);

const poolDir =
  process.env.POOL_DIR ?? "/srv/worker-state/account-pools/live-codex-auth";
const modelBackend = process.env.MODEL_BACKEND ?? "xiaomi-mimo-token-plan";
const accountId = process.env.ACCOUNT_ID ?? "account-q";
const model = process.env.MODEL ?? "mimo-v2.6-pro";
const ownerId =
  process.env.OWNER_ID ?? `operator-recovery:${process.env.USER ?? "unknown"}`;

const store = codexAccountCapacityStore(poolDir, { modelBackend });
const demand = {
  provider: "codex",
  model,
  reasoningEffort: "high",
  serviceTier: "default",
};
const read = (now) => ({
  withDemand: store.readState({ accountId, demand, now }),
  accountWide: store.readState({ accountId, now }),
});
const fmt = (s) =>
  s ? JSON.stringify({ phase: s.phase, capacity: s.capacity }) : "null";

let now = new Date();
const before = read(now);
console.log(
  "BEFORE",
  JSON.stringify({
    withDemand: fmt(before.withDemand),
    accountWide: fmt(before.accountWide),
  }),
);

let clearedCount = 0;
for (let i = 0; i < 64; i++) {
  now = new Date();
  const current = read(now).withDemand ?? read(now).accountWide;
  if (!current) break;
  const claimed = store.tryClaimRecheck({
    state: current,
    ownerId,
    now,
    ttlMs: 30_000,
    mode: WorkerAccountCapacityRecheckMode.Refresh,
  });
  console.log(`loop${i} claim=${claimed.status}`);
  if (claimed.status !== WorkerAccountCapacityClaimStatus.Claimed) break;
  const resolved = store.resolveRecheck({
    claim: claimed.claim,
    observedAt: new Date(),
    resolution: { type: WorkerAccountCapacityResolutionType.Available },
  });
  console.log(`loop${i} resolve=${resolved.status}`);
  if (resolved.status !== WorkerAccountCapacityResolveStatus.Applied) break;
  clearedCount++;
}

now = new Date();
const after = read(now);
console.log(
  "AFTER",
  JSON.stringify({
    withDemand: fmt(after.withDemand),
    accountWide: fmt(after.accountWide),
    clearedCount,
  }),
);
