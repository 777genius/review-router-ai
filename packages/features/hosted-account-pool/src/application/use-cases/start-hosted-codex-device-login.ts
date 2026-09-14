import {
  HOSTED_CODEX_DEVICE_LOGIN_TTL_MS,
  type HostedCodexDeviceAuthGateway,
  type HostedCodexDeviceLoginStore,
} from "../ports/hosted-codex-device-login-port";
import type {
  HostedDeviceLoginId,
  WorkspaceId,
} from "../../domain/identifiers";

export type HostedCodexDeviceLoginPublicView = {
  readonly loginId: HostedDeviceLoginId;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: Date;
  readonly intervalSeconds: number;
};

export async function startHostedCodexDeviceLogin(
  command: {
    readonly id: HostedDeviceLoginId;
    readonly workspaceId: WorkspaceId;
    readonly actor: string;
    readonly label: string;
    readonly priority: number;
    readonly now: Date;
  },
  dependencies: {
    readonly store: HostedCodexDeviceLoginStore;
    readonly deviceAuth: HostedCodexDeviceAuthGateway;
  },
): Promise<HostedCodexDeviceLoginPublicView> {
  await dependencies.store.expireStalePending(command.workspaceId, command.now);
  const existing = await dependencies.store.findPendingByWorkspace(
    command.workspaceId,
  );
  if (existing) throw new Error("hosted_pool_device_login_in_flight");

  const userCode = await dependencies.deviceAuth.requestUserCode();
  const expiresAt = new Date(
    command.now.getTime() + HOSTED_CODEX_DEVICE_LOGIN_TTL_MS,
  );
  await dependencies.store.createPending({
    id: command.id,
    workspaceId: command.workspaceId,
    actor: command.actor,
    label: command.label,
    priority: command.priority,
    userCode: userCode.userCode,
    verificationUrl: userCode.verificationUrl,
    deviceAuthId: userCode.deviceAuthId,
    status: "pending",
    expiresAt,
    createdAt: command.now,
    updatedAt: command.now,
  });
  return {
    loginId: command.id,
    userCode: userCode.userCode,
    verificationUrl: userCode.verificationUrl,
    expiresAt,
    intervalSeconds: userCode.intervalSeconds,
  };
}
