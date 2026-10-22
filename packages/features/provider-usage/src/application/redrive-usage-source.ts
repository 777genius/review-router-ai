/** Operator input is resolved by a trusted server/CLI; never by report payloads. */
export interface UsageSourceRedriveRequest {
  operationId: string;
  operatorWorkspaceId: string;
  actorId: string;
  workspaceId: string;
  sourceInstance: string;
  expectedFence: bigint;
  expectedDeadLetteredAt: Date;
  reason: string;
}
export interface UsageSourceRedriveReceipt {
  status: "queued" | "already_queued";
  auditId: string;
  sourceInstance: string;
  workspaceId: string;
  queuedFence: string;
}
export interface UsageSourceRedrivePort {
  redrive(input: UsageSourceRedriveRequest): Promise<UsageSourceRedriveReceipt>;
}
export class RedriveUsageSource {
  constructor(private readonly sources: UsageSourceRedrivePort) {}
  execute(input: UsageSourceRedriveRequest) {
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(input.operationId) ||
      !input.actorId ||
      !input.operatorWorkspaceId ||
      !input.workspaceId ||
      !input.sourceInstance ||
      input.sourceInstance.length > 256 ||
      input.expectedFence < 0n ||
      !Number.isFinite(input.expectedDeadLetteredAt.getTime()) ||
      !input.reason.trim() ||
      input.reason.length > 200
    )
      throw new Error("usage_redrive_input_invalid");
    return this.sources.redrive(input);
  }
}
