// Read-only dump of the worker-account capacity store state for one account.
const base =
  process.env.BRIDGE_DIST ??
  "/opt/subscription-runtime/mimo-project-bridge-current/dist";
const { codexAccountCapacityStore } = await import(
  base + "/worker-codex/application/codex-account-capacity-store.js"
);

const poolDir =
  process.env.POOL_DIR ?? "/srv/worker-state/account-pools/live-codex-auth";
const modelBackend = process.env.MODEL_BACKEND ?? "xiaomi-mimo-token-plan";
const accountId = process.env.ACCOUNT_ID ?? "account-q";
const model = process.env.MODEL ?? "mimo-v2.6-pro";

const store = codexAccountCapacityStore(poolDir, { modelBackend });
const demand = {
  provider: "codex",
  model,
  reasoningEffort: "high",
  serviceTier: "default",
};
const r = store.read({ accountId, demand, now: new Date() });
const s = store.readState({ accountId, demand, now: new Date() });
console.log("read:", JSON.stringify(r));
console.log(
  "state:",
  s ? JSON.stringify({ phase: s.phase, capacity: s.capacity }) : "null",
);
