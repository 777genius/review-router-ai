/** Test-only composition of unchanged production RR readers and projections. */
import assert from "node:assert/strict";
import type { ConnectionProfileV3 } from "@agent-teams/account-gateway/contracts";
import { createNativeConnectionManagementClient } from "../../../apps/web/src/server/native-connection-client";
import { nativeConnectionProfileView } from "../../../apps/web/src/server/native-connection-view";
import { readScopedAccountModels } from "../../../apps/web/src/server/native-account-models";
import { accountLimitsReader } from "../../../apps/web/src/server/account-limits-composition";
import { projectAccountLimits } from "../../../packages/features/provider-accounts/src/account-limits/domain/account-limits";
import { createExtensionUsageObserver } from "./provider-subscriptions-extension-usage";
export { submitSetup } from "./provider-subscriptions-extension-setup";

export async function createExtensionObserver(input: {
  origin: string;
  managementToken: string;
  consumerToken: string;
  ownerRef: string;
  accountRef: string;
  profile: ConnectionProfileV3;
  modelId: string;
}) {
  const client = createNativeConnectionManagementClient({
    role: "management",
    origin: input.origin,
    token: input.managementToken,
  });
  const account = await client.get(input.accountRef);
  assert.equal(account.ownerRef, input.ownerRef);
  assert.equal(account.profileId, input.profile.profileId);
  assert.equal(account.state, "active");
  const target = {
    ownerRef: input.ownerRef,
    accountRef: input.accountRef,
    profileId: input.profile.profileId,
    expectedAuthorizationEpoch: account.authorizationEpoch,
  };
  const profile = nativeConnectionProfileView(input.profile);
  const limits = await accountLimitsReader({
    role: "management",
    origin: input.origin,
    token: input.managementToken,
  });
  const usage = createExtensionUsageObserver(input);
  const displayContext = () => ({
    now: new Date(),
    fetchedAt: new Date().toISOString(),
    displayToken: "joined-extension-display",
  });
  return {
    beforeDispatch: usage.beforeDispatch,
    afterRetirement: usage.afterRetirement,
    beforeReview: async () => {
      const models = await readScopedAccountModels(profile, target, client);
      assert.equal(models.status, "snapshot");
      assert.ok(models.status === "snapshot");
      assert.equal(models.source, input.profile.modelPolicy.sourceId);
      assert.ok(models.models.some((model) => model.modelId === input.modelId));
      const result = await limits.read(target);
      assert.equal(
        result.status,
        "unknown",
        "no source quota has been observed yet",
      );
      const view = projectAccountLimits(result, displayContext());
      assert.equal(view.status, "unknown");
      assert.equal(
        "windows" in view,
        false,
        "unknown quota must not become zero",
      );
      return {
        scopedModels: true as const,
        modelId: input.modelId,
        limitsBeforeReview: view.status,
      };
    },
    afterReview: async () => {
      const result = await limits.read(target);
      assert.equal(result.status, "snapshot");
      assert.ok(result.status === "snapshot");
      const window = result.windows.find(
        (value) => value.id === "request_rate",
      );
      assert.ok(window && window.family === "native");
      assert.equal(window.providerId, input.profile.provider.id);
      assert.equal(window.dimension, "rate_limit");
      assert.equal(window.unit, "requests");
      assert.equal(window.durationSeconds, 60);
      assert.equal(window.usedPercent, 2);
      const view = projectAccountLimits(result, displayContext());
      assert.equal(view.status, "snapshot");
      assert.ok(view.status === "snapshot");
      assert.ok(
        view.windows.some(
          (value) =>
            value.dimension === "rate_limit" &&
            value.unit === "requests" &&
            value.usedPercent === 2 &&
            value.remainingPercent === 98,
        ),
      );
      assert.equal("physicalGeneration" in view, false);
      assert.equal("principalVersion" in view, false);
      return {
        ...(await usage.afterReview()),
        limitsAfterReview: view.status,
        rateLimitUsedPercent: window.usedPercent,
      };
    },
  };
}
