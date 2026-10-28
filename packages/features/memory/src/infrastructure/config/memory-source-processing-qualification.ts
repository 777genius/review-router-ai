import { readConversationQualification } from "@reviewrouter/platform-config";
export type MemorySourceProcessingQualification = {
  readonly proofId: string;
  readonly repositories: readonly {
    readonly workspaceId: string;
    readonly repositoryId: string;
  }[];
};
/** Same strict deployed qualification parser as provisioning and plain conversation inference. */
export function readMemorySourceProcessingQualification(
  raw: string | undefined,
): MemorySourceProcessingQualification | null {
  return readConversationQualification(raw);
}
