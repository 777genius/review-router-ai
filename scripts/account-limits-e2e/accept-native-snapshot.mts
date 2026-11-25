import assert from "node:assert/strict";
import { accountLimitsReader } from "../../apps/web/src/server/account-limits-composition";
import { readAccountLimits } from "../../packages/features/provider-accounts/src/account-limits/application/use-cases/read-account-limits";
import type { AccountLimitsTarget } from "../../packages/features/provider-accounts/src/account-limits/application/ports/account-limits-reader";

/** Called by the source-owned disposable native/Gateway HTTP harness while alive.
 * Receives its finite fixture authority in memory; never persists credentials.
 */
export default async function acceptNativeSnapshot(fixture: {
  origin: string;
  token: string;
  input: AccountLimitsTarget;
}): Promise<void> {
  const reader = await accountLimitsReader({
    role: "consumer-control",
    origin: fixture.origin,
    token: fixture.token,
  });
  const authorization = {
    target: fixture.input,
    displayToken: "controlled-native-rr-observation",
  };
  const view = await readAccountLimits({
    reader,
    authorize: async () => authorization,
    now: () => new Date(),
  });
  assert.equal(view.status, "snapshot");
  if (view.status !== "snapshot") throw new Error("native_rr_snapshot_missing");
  assert.ok(
    view.windows.some(
      (window) =>
        window.usedPercent === 37.5 && window.remainingPercent === 62.5,
    ),
  );
  assert.equal(view.refreshAvailable, false);
  const display = JSON.stringify(view);
  for (const field of [
    "ownerRef",
    "accountRef",
    "physicalGeneration",
    "principalVersion",
    "revision",
  ])
    assert.equal(display.includes(`"${field}"`), false);
  assert.equal(display.includes(fixture.token), false);

  // Cached rereads retain the original observation, rather than manufacturing now.
  const reread = await readAccountLimits({
    reader,
    authorize: async () => authorization,
    now: () => new Date(),
  });
  assert.equal(reread.status, "snapshot");
  if (reread.status === "snapshot")
    assert.deepEqual(reread.windows, view.windows);

  let checks = 0;
  const fenced = await readAccountLimits({
    reader,
    authorize: async () =>
      ++checks === 1
        ? authorization
        : {
            target: {
              ...fixture.input,
              expectedAuthorizationEpoch:
                fixture.input.expectedAuthorizationEpoch + 1,
            },
            displayToken: "controlled-native-reconnected",
          },
    now: () => new Date(),
  });
  assert.equal(fenced.status, "restricted");
  assert.equal("windows" in fenced, false);
}

export { acceptNativeSnapshot as acceptAccountLimits };

// The source-owned harness invokes only this preloaded fixture callback, keeping
// its dependency graph closed without importing a caller-selected module path.
Object.defineProperty(
  globalThis,
  Symbol.for("account-limits-e2e.acceptAccountLimits"),
  { value: acceptNativeSnapshot },
);
