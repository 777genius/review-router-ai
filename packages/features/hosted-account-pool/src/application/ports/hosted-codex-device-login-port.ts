import type {
  HostedDeviceLoginId,
  WorkspaceId,
} from "../../domain/identifiers";

export const HOSTED_CODEX_DEVICE_LOGIN_TTL_MS = 15 * 60 * 1000;

export type HostedCodexDeviceLoginStatus =
  | "pending"
  | "imported"
  | "failed"
  | "expired";

export type HostedCodexDeviceLoginRecord = {
  readonly id: HostedDeviceLoginId;
  readonly workspaceId: WorkspaceId;
  readonly actor: string;
  readonly label: string;
  readonly priority: number;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly deviceAuthId: string | null;
  readonly status: HostedCodexDeviceLoginStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type HostedCodexDeviceAuthUserCode = {
  readonly deviceAuthId: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly intervalSeconds: number;
};

export type HostedCodexDeviceAuthPollResult =
  | { readonly status: "pending" }
  | { readonly status: "denied" }
  | { readonly status: "expired" }
  | {
      readonly status: "authorized";
      readonly authorizationCode: string;
      readonly codeVerifier: string;
    };

export type HostedCodexDeviceAuthTokens = {
  readonly idToken: string;
  readonly accessToken: string;
  readonly refreshToken: string;
};

export interface HostedCodexDeviceAuthGateway {
  requestUserCode(): Promise<HostedCodexDeviceAuthUserCode>;
  pollAuthorization(input: {
    readonly deviceAuthId: string;
    readonly userCode: string;
  }): Promise<HostedCodexDeviceAuthPollResult>;
  exchangeAuthorizationCode(input: {
    readonly authorizationCode: string;
    readonly codeVerifier: string;
  }): Promise<HostedCodexDeviceAuthTokens>;
}

export interface HostedCodexDeviceLoginStore {
  expireStalePending(workspaceId: WorkspaceId, now: Date): Promise<void>;
  findPendingByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<HostedCodexDeviceLoginRecord | null>;
  createPending(record: HostedCodexDeviceLoginRecord): Promise<void>;
  findById(
    id: HostedDeviceLoginId,
  ): Promise<HostedCodexDeviceLoginRecord | null>;
  markTerminal(input: {
    readonly id: HostedDeviceLoginId;
    readonly expectedStatus: "pending";
    readonly status: Exclude<HostedCodexDeviceLoginStatus, "pending">;
    readonly now: Date;
  }): Promise<boolean>;
}

export interface HostedCodexDeviceLoginEnrollPort {
  enrollAuthJson(input: {
    readonly workspaceId: string;
    readonly label: string;
    readonly priority: number;
    readonly authJson: Uint8Array;
  }): Promise<void>;
}
