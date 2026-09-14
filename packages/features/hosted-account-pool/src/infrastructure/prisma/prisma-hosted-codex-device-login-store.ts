import type {
  HostedCodexDeviceLoginRecord,
  HostedCodexDeviceLoginStatus,
  HostedCodexDeviceLoginStore,
} from "../../application/ports/hosted-codex-device-login-port";
import type {
  HostedDeviceLoginId,
  WorkspaceId,
} from "../../domain/identifiers";
import { hostedDeviceLoginId, workspaceId } from "../../domain/identifiers";

type DeviceLoginRow = {
  readonly id: string;
  readonly workspaceId: string;
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

type DeviceLoginDelegate = {
  create(args: { readonly data: DeviceLoginRow }): Promise<unknown>;
  findFirst(args: {
    readonly where: Record<string, unknown>;
  }): Promise<DeviceLoginRow | null>;
  findUnique(args: {
    readonly where: { readonly id: string };
  }): Promise<DeviceLoginRow | null>;
  updateMany(args: {
    readonly where: Record<string, unknown>;
    readonly data: Record<string, unknown>;
  }): Promise<{ readonly count: number }>;
};

export class PrismaHostedCodexDeviceLoginStore implements HostedCodexDeviceLoginStore {
  constructor(
    private readonly prisma: {
      readonly hostedCodexDeviceLogin: DeviceLoginDelegate;
    },
  ) {}

  async expireStalePending(id: WorkspaceId, now: Date): Promise<void> {
    await this.prisma.hostedCodexDeviceLogin.updateMany({
      where: {
        workspaceId: id,
        status: "pending",
        expiresAt: { lte: now },
      },
      data: {
        status: "expired",
        deviceAuthId: null,
        updatedAt: now,
      },
    });
  }

  async findPendingByWorkspace(
    id: WorkspaceId,
  ): Promise<HostedCodexDeviceLoginRecord | null> {
    const row = await this.prisma.hostedCodexDeviceLogin.findFirst({
      where: { workspaceId: id, status: "pending" },
    });
    return row ? toRecord(row) : null;
  }

  async createPending(record: HostedCodexDeviceLoginRecord): Promise<void> {
    try {
      await this.prisma.hostedCodexDeviceLogin.create({
        data: {
          id: record.id,
          workspaceId: record.workspaceId,
          actor: record.actor,
          label: record.label,
          priority: record.priority,
          userCode: record.userCode,
          verificationUrl: record.verificationUrl,
          deviceAuthId: record.deviceAuthId,
          status: record.status,
          expiresAt: record.expiresAt,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        },
      });
    } catch (error) {
      if (isPrismaErrorCode(error, "P2002")) {
        throw new Error("hosted_pool_device_login_in_flight", { cause: error });
      }
      throw error;
    }
  }

  async findById(
    id: HostedDeviceLoginId,
  ): Promise<HostedCodexDeviceLoginRecord | null> {
    const row = await this.prisma.hostedCodexDeviceLogin.findUnique({
      where: { id },
    });
    return row ? toRecord(row) : null;
  }

  async markTerminal(input: {
    readonly id: HostedDeviceLoginId;
    readonly expectedStatus: "pending";
    readonly status: Exclude<HostedCodexDeviceLoginStatus, "pending">;
    readonly now: Date;
  }): Promise<boolean> {
    const result = await this.prisma.hostedCodexDeviceLogin.updateMany({
      where: { id: input.id, status: input.expectedStatus },
      data: {
        status: input.status,
        deviceAuthId: null,
        updatedAt: input.now,
      },
    });
    return result.count === 1;
  }
}

function toRecord(row: DeviceLoginRow): HostedCodexDeviceLoginRecord {
  return {
    id: hostedDeviceLoginId(row.id),
    workspaceId: workspaceId(row.workspaceId),
    actor: row.actor,
    label: row.label,
    priority: row.priority,
    userCode: row.userCode,
    verificationUrl: row.verificationUrl,
    deviceAuthId: row.deviceAuthId,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
