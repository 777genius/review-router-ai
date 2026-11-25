import type { CodexRotatingSeedScriptDescriptor } from "./codex-rotating-installer";

export enum CodexRotatingSetupManifestStatus {
  Issued = "issued",
  Fetched = "fetched",
  Consumed = "consumed",
  Expired = "expired",
  Superseded = "superseded",
  Recovered = "recovered",
}

export type ForcedRecoveryAuthority = {
  readonly kind: "allocation" | "replay";
  readonly requestId: string;
  readonly epoch: bigint;
  readonly databaseRecoveryWitness: string | null;
  readonly manifestDatabaseRecoveryWitness: string | null;
};

export type SetupRecoveryRequestFacts = {
  readonly id: string;
  readonly mutationEpoch: bigint;
  readonly databaseRecoveryWitness: string | null;
  readonly mode: string;
  readonly state: string;
  readonly latestManifestId: string | null;
};

function isRecoveryRequestMode(mode: string): boolean {
  return mode === "forced_reseed" || mode === "forced_reseed_account_switch";
}

export type SetupManifestLifetimeFacts = Readonly<{
  status: CodexRotatingSetupManifestStatus;
  expiresAt: Date;
  consumedAt: Date | null;
  recoveryExpiresAt: Date | null;
}>;

/** Facts must be read under the provider mutation lock before evaluating. */
export function evaluateSetupManifestRecoveryAuthority(
  input: Readonly<{
    recovery: Readonly<{ requestId: string; epoch: bigint }> | null;
    provider: Readonly<{
      mutationOwner: string | null;
      mutationOwnerId: string | null;
      mutationEpoch: bigint;
    }>;
    active: Readonly<{
      id: string;
      status: CodexRotatingSetupManifestStatus;
      mutationEpoch: bigint | null;
      databaseRecoveryWitness: string | null;
    }> | null;
    recoveryRequest: SetupRecoveryRequestFacts | null;
    activeRecoveryRequest: Readonly<{ id: string }> | null;
  }>,
): ForcedRecoveryAuthority | null {
  const { recovery, provider, active, recoveryRequest, activeRecoveryRequest } =
    input;
  if (
    activeRecoveryRequest &&
    activeRecoveryRequest.id !== recoveryRequest?.id
  ) {
    throw new Error(
      recovery
        ? "codex_rotating_setup_recovery_request_conflict"
        : "codex_rotating_setup_recovery_required",
    );
  }
  if (active?.status === CodexRotatingSetupManifestStatus.Fetched) {
    throw new Error("codex_rotating_setup_recovery_required");
  }
  if (provider.mutationOwner === "recovery") {
    if (
      !recovery ||
      !recoveryRequest ||
      recovery.epoch !== recoveryRequest.mutationEpoch ||
      provider.mutationEpoch !== recoveryRequest.mutationEpoch ||
      provider.mutationOwnerId !== `setup-recovery:${recovery.requestId}`
    ) {
      throw new Error("codex_rotating_setup_recovery_required");
    }
  } else if (recovery) {
    if (
      !recoveryRequest ||
      recoveryRequest.mutationEpoch !== recovery.epoch ||
      !isRecoveryRequestMode(recoveryRequest.mode) ||
      !["active", "manifest_issued"].includes(recoveryRequest.state) ||
      provider.mutationOwner !== "setup" ||
      provider.mutationOwnerId !== recoveryRequest.latestManifestId
    ) {
      throw new Error("codex_rotating_setup_recovery_already_used");
    }
  }
  if (
    recovery &&
    (!recoveryRequest ||
      !isRecoveryRequestMode(recoveryRequest.mode) ||
      !["active", "manifest_issued"].includes(recoveryRequest.state))
  ) {
    throw new Error("codex_rotating_setup_recovery_already_used");
  }
  const forcedRecoveryAuthority: ForcedRecoveryAuthority | null =
    recovery &&
    recoveryRequest &&
    isRecoveryRequestMode(recoveryRequest.mode) &&
    recoveryRequest.mutationEpoch === recovery.epoch
      ? recoveryRequest.state === "active" &&
        recoveryRequest.latestManifestId === null &&
        provider.mutationOwner === "recovery" &&
        provider.mutationOwnerId === `setup-recovery:${recovery.requestId}` &&
        provider.mutationEpoch === recovery.epoch
        ? {
            kind: "allocation",
            requestId: recovery.requestId,
            epoch: recovery.epoch,
            databaseRecoveryWitness: recoveryRequest.databaseRecoveryWitness,
            manifestDatabaseRecoveryWitness: null,
          }
        : recoveryRequest.state === "manifest_issued" &&
            active?.id === recoveryRequest.latestManifestId &&
            active.mutationEpoch !== null &&
            active.mutationEpoch === provider.mutationEpoch &&
            provider.mutationEpoch === recovery.epoch + 1n &&
            provider.mutationOwner === "setup" &&
            provider.mutationOwnerId === active.id
          ? {
              kind: "replay",
              requestId: recovery.requestId,
              epoch: recovery.epoch,
              databaseRecoveryWitness: recoveryRequest.databaseRecoveryWitness,
              manifestDatabaseRecoveryWitness: active.databaseRecoveryWitness,
            }
          : null
      : null;
  if (recovery && forcedRecoveryAuthority === null) {
    throw new Error("codex_rotating_setup_recovery_required");
  }
  return forcedRecoveryAuthority;
}

export function assertSetupManifestFetchable(
  row: SetupManifestLifetimeFacts,
  now: Date,
): void {
  assertSetupManifestNotExpiredOrConsumed(row, now);
  if (row.status !== CodexRotatingSetupManifestStatus.Issued) {
    throw new Error("codex_rotating_setup_manifest_reused");
  }
}

export function assertSetupManifestNotExpiredOrConsumed(
  row: SetupManifestLifetimeFacts,
  now: Date,
): void {
  if (
    row.status === CodexRotatingSetupManifestStatus.Consumed ||
    row.consumedAt
  ) {
    throw new Error("codex_rotating_setup_manifest_reused");
  }
  if (
    row.status === CodexRotatingSetupManifestStatus.Expired ||
    row.expiresAt <= now
  ) {
    throw new Error("codex_rotating_setup_manifest_expired");
  }
}

export function assertFetchedRecoveryWindow(
  row: SetupManifestLifetimeFacts,
  now: Date,
): void {
  if (
    row.status !== CodexRotatingSetupManifestStatus.Fetched ||
    row.consumedAt ||
    !row.recoveryExpiresAt ||
    row.recoveryExpiresAt <= now
  ) {
    throw new Error("codex_rotating_setup_manifest_expired");
  }
}

type ReusableSetupManifestFacts = Readonly<{
  repositoryFullName: string;
  repositoryId: string;
  repositoryIdentityVersion: number;
  generationHashSalt: string;
  accountFingerprintSalt: string;
  installer: CodexRotatingSeedScriptDescriptor;
}>;

export function isReusableIssuedManifest(input: {
  readonly manifest: ReusableSetupManifestFacts;
  readonly provider: {
    readonly generationHashSalt: string;
    readonly accountFingerprintSalt: string;
  };
  readonly repositoryFullName: string;
  readonly githubRepositoryId: string;
  readonly identityVersion: number;
  readonly installer: CodexRotatingSeedScriptDescriptor;
}): boolean {
  return (
    input.manifest.repositoryFullName === input.repositoryFullName &&
    input.manifest.repositoryId === input.githubRepositoryId &&
    input.manifest.repositoryIdentityVersion === input.identityVersion &&
    input.manifest.generationHashSalt === input.provider.generationHashSalt &&
    input.manifest.accountFingerprintSalt ===
      input.provider.accountFingerprintSalt &&
    input.manifest.installer.url === input.installer.url &&
    input.manifest.installer.version === input.installer.version &&
    input.manifest.installer.sha256 === input.installer.sha256
  );
}
