import type { HostedPoolDashboardView } from "../../src/server/hosted-pool-dashboard";
import type { HostedPoolDeviceLoginFlight } from "./hosted-pool-device-login";

export type HostedPoolPreviewScenario =
  | "empty"
  | "waiting"
  | "enrolled"
  | "paused"
  | "reconnect";

export function hostedPoolPreviewScenarios(): readonly HostedPoolPreviewScenario[] {
  return ["empty", "waiting", "enrolled", "paused", "reconnect"];
}

export function resolveHostedPoolPreviewScenario(
  value: string,
): HostedPoolPreviewScenario {
  return hostedPoolPreviewScenarios().includes(
    value as HostedPoolPreviewScenario,
  )
    ? (value as HostedPoolPreviewScenario)
    : "empty";
}

export function buildHostedPoolPreviewView(
  scenario: HostedPoolPreviewScenario,
): HostedPoolDashboardView {
  if (scenario === "empty" || scenario === "waiting") {
    return {
      gate: "enabled",
      pool: null,
      accounts: [],
      repositories: [],
    };
  }

  if (scenario === "enrolled") {
    return {
      gate: "enabled",
      pool: previewPool({ accountCount: 3, healthyAccountCount: 2 }),
      accounts: [
        previewAccount({
          id: "account-primary" as never,
          label: "Iliya",
          priority: 10,
        }),
        previewAccount({
          id: "account-backup" as never,
          label: "Reviews spare",
          priority: 20,
        }),
        previewAccount({
          id: "account-weekend" as never,
          label: "Weekend",
          priority: 30,
          availability: { status: "paused", reason: "operator" },
        }),
      ],
      repositories: [],
    };
  }

  if (scenario === "paused") {
    return {
      gate: "enabled",
      pool: previewPool({ accountCount: 2, healthyAccountCount: 0 }),
      accounts: [
        previewAccount({
          id: "account-primary" as never,
          label: "Iliya",
          priority: 10,
          availability: { status: "paused", reason: "operator" },
        }),
        previewAccount({
          id: "account-backup" as never,
          label: "Reviews spare",
          priority: 20,
          availability: { status: "paused", reason: "operator" },
        }),
      ],
      repositories: [],
    };
  }

  return {
    gate: "enabled",
    pool: previewPool({ accountCount: 2, healthyAccountCount: 1 }),
    accounts: [
      previewAccount({
        id: "account-primary" as never,
        label: "Iliya",
        priority: 10,
      }),
      previewAccount({
        id: "account-expired" as never,
        label: "Old laptop",
        priority: 20,
        availability: { status: "quarantined", reason: "real_401" },
      }),
    ],
    repositories: [],
  };
}

export function buildHostedPoolPreviewFlight(
  scenario: HostedPoolPreviewScenario,
): HostedPoolDeviceLoginFlight | undefined {
  if (scenario !== "waiting") return undefined;
  return {
    loginId: "preview-login",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresAt: new Date(Date.now() + 14 * 60_000 + 32_000).toISOString(),
    intervalMs: 60_000,
  };
}

function previewPool(input: {
  readonly accountCount: number;
  readonly healthyAccountCount: number;
}): NonNullable<HostedPoolDashboardView["pool"]> {
  return {
    id: "pool-preview" as never,
    workspaceId: "workspace-preview" as never,
    status: "active",
    isDefault: true,
    revision: 1,
    accountCount: input.accountCount,
    healthyAccountCount: input.healthyAccountCount,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
  };
}

function previewAccount(
  overrides: Partial<HostedPoolDashboardView["accounts"][number]> &
    Pick<HostedPoolDashboardView["accounts"][number], "id" | "label">,
): HostedPoolDashboardView["accounts"][number] {
  return {
    priority: 10,
    availability: { status: "healthy" },
    authGeneration: 2,
    healthVersion: 1,
    validatedAt: new Date("2026-09-14T12:00:00.000Z"),
    credentialExpiresAt: null,
    refreshDue: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-14T12:00:00.000Z"),
    ...overrides,
  };
}
