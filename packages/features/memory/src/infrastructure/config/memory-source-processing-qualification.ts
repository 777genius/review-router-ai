import {
  readConversationQualification,
  type ConversationQualification,
} from "@reviewrouter/platform-config";
export type MemorySourceProcessingQualification = ConversationQualification;
/** Same strict deployed qualification parser as provisioning and plain conversation inference. */
export function readMemorySourceProcessingQualification(
  raw: string | undefined,
): MemorySourceProcessingQualification | null {
  return readConversationQualification(raw);
}
