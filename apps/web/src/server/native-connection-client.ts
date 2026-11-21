import {
  createConsumerControlClient,
  createManagementClient,
  type ConsumerControlClient,
  type ConsumerControlConfig,
  type ManagementClient,
  type ManagementConfig,
} from "@agent-teams/account-gateway/http";

type NativeEnrollment = Pick<
  ManagementClient,
  "beginConnection" | "reconnectConnection" | "submitConnection"
>;

function withNativeEnrollment<T extends NativeEnrollment>(
  ordinary: T,
  enrollment: NativeEnrollment,
): T {
  return Object.freeze({
    ...ordinary,
    beginConnection: enrollment.beginConnection,
    reconnectConnection: enrollment.reconnectConnection,
    submitConnection: enrollment.submitConnection,
  });
}

// Native SSO may poll its provider for 75 seconds within one journaled grant.
// Only enrollment gets the full HTTP budget. Reads and lifecycle operations
// retain RR's existing 10-second limit; caller cancellation still reaches SDK.
export function createNativeConnectionManagementClient(
  settings: Omit<ManagementConfig, "timeoutMs">,
): ManagementClient {
  return withNativeEnrollment(
    createManagementClient({ ...settings, timeoutMs: 10_000 }),
    createManagementClient({ ...settings, timeoutMs: 120_000 }),
  );
}

export function createNativeConnectionConsumerControlClient(
  settings: Omit<ConsumerControlConfig, "timeoutMs">,
): ConsumerControlClient {
  return withNativeEnrollment(
    createConsumerControlClient({ ...settings, timeoutMs: 10_000 }),
    createConsumerControlClient({ ...settings, timeoutMs: 120_000 }),
  );
}
