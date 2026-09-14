import type {
  HostedCodexDeviceAuthGateway,
  HostedCodexDeviceLoginEnrollPort,
  HostedCodexDeviceLoginRecord,
  HostedCodexDeviceLoginStore,
} from "../ports/hosted-codex-device-login-port";
import type {
  HostedDeviceLoginId,
  WorkspaceId,
} from "../../domain/identifiers";
import { hostedCodexAuthJsonFromDeviceTokens } from "./hosted-codex-device-login-auth-json";

export type HostedCodexDeviceLoginPollView =
  | {
      readonly status: "pending";
      readonly loginId: HostedDeviceLoginId;
      readonly userCode: string;
      readonly verificationUrl: string;
      readonly expiresAt: Date;
    }
  | {
      readonly status: "imported";
      readonly loginId: HostedDeviceLoginId;
    };

export async function pollHostedCodexDeviceLogin(
  command: {
    readonly id: HostedDeviceLoginId;
    readonly workspaceId: WorkspaceId;
    readonly actor: string;
    readonly now: Date;
  },
  dependencies: {
    readonly store: HostedCodexDeviceLoginStore;
    readonly deviceAuth: HostedCodexDeviceAuthGateway;
    readonly enroll: HostedCodexDeviceLoginEnrollPort;
  },
): Promise<HostedCodexDeviceLoginPollView> {
  const record = await dependencies.store.findById(command.id);
  if (!record || record.workspaceId !== command.workspaceId) {
    throw new Error("hosted_pool_device_login_not_found");
  }
  if (record.actor !== command.actor) {
    throw new Error("hosted_pool_device_login_forbidden");
  }
  if (record.status === "imported") {
    return { status: "imported", loginId: record.id };
  }
  if (
    record.status === "expired" ||
    record.expiresAt.getTime() <= command.now.getTime()
  ) {
    await expire(dependencies.store, record, command.now);
    throw new Error("hosted_pool_device_login_expired");
  }
  if (record.status !== "pending" || !record.deviceAuthId) {
    throw new Error("hosted_pool_device_login_failed");
  }

  let poll: Awaited<
    ReturnType<HostedCodexDeviceAuthGateway["pollAuthorization"]>
  >;
  try {
    poll = await dependencies.deviceAuth.pollAuthorization({
      deviceAuthId: record.deviceAuthId,
      userCode: record.userCode,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "hosted_pool_device_login_provider_unavailable"
    ) {
      throw error;
    }
    await fail(dependencies.store, record, command.now);
    throw error;
  }
  if (poll.status === "pending") {
    return {
      status: "pending",
      loginId: record.id,
      userCode: record.userCode,
      verificationUrl: record.verificationUrl,
      expiresAt: record.expiresAt,
    };
  }
  if (poll.status === "denied") {
    await fail(dependencies.store, record, command.now);
    throw new Error("hosted_pool_device_login_denied");
  }
  if (poll.status === "expired") {
    await expire(dependencies.store, record, command.now);
    throw new Error("hosted_pool_device_login_expired");
  }

  let authJson: Uint8Array | undefined;
  try {
    const tokens = await dependencies.deviceAuth.exchangeAuthorizationCode({
      authorizationCode: poll.authorizationCode,
      codeVerifier: poll.codeVerifier,
    });
    authJson = hostedCodexAuthJsonFromDeviceTokens({
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      lastRefresh: command.now,
    });
    await dependencies.enroll.enrollAuthJson({
      workspaceId: record.workspaceId,
      label: record.label,
      priority: record.priority,
      authJson,
    });
  } catch (error) {
    await fail(dependencies.store, record, command.now);
    if (error instanceof Error && error.message.startsWith("hosted_")) {
      throw error;
    }
    throw new Error("hosted_pool_device_login_artifact_invalid", {
      cause: error,
    });
  } finally {
    authJson?.fill(0);
  }

  const completed = await dependencies.store.markTerminal({
    id: record.id,
    expectedStatus: "pending",
    status: "imported",
    now: command.now,
  });
  if (!completed) throw new Error("hosted_pool_device_login_failed");
  return { status: "imported", loginId: record.id };
}

async function fail(
  store: HostedCodexDeviceLoginStore,
  record: HostedCodexDeviceLoginRecord,
  now: Date,
): Promise<void> {
  await store.markTerminal({
    id: record.id,
    expectedStatus: "pending",
    status: "failed",
    now,
  });
}

async function expire(
  store: HostedCodexDeviceLoginStore,
  record: HostedCodexDeviceLoginRecord,
  now: Date,
): Promise<void> {
  if (record.status === "pending") {
    await store.markTerminal({
      id: record.id,
      expectedStatus: "pending",
      status: "expired",
      now,
    });
  }
}
