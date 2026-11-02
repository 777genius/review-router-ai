import type {
  ConversationProcessRequest,
  ConversationProcessResult,
  ConversationPublicationReceipt,
} from "../../domain/conversation.js";
import type {
  ConversationAction,
  ConversationDecision,
  ConversationIdentity,
  ConversationRecord,
  ConversationSnapshot,
  RequestControls,
} from "../../domain/conversation.js";
import type { TextInferencePort } from "./text-inference-port.js";

export interface ConversationSourcePort {
  identify(
    input: ConversationProcessRequest,
    controls: RequestControls,
  ): Promise<ConversationIdentity>;
  read(
    identity: ConversationIdentity,
    controls: RequestControls,
  ): Promise<ConversationSnapshot>;
  isCurrent(
    snapshot: ConversationSnapshot,
    controls: RequestControls,
  ): Promise<boolean>;
  revokeDeleted?(
    input: ConversationProcessRequest,
    controls: RequestControls,
  ): Promise<void>;
}
export interface ConversationProcessingStore {
  accept(
    identity: ConversationIdentity,
    deadlineAt: Date,
  ): Promise<{
    readonly created: boolean;
    readonly record: ConversationRecord;
  }>;
  read(id: string): Promise<ConversationRecord | null>;
  bind(id: string, manifest: string): Promise<boolean>;
  markModelDispatched(id: string): Promise<boolean>;
  freezeOutput(id: string, output: ConversationDecision): Promise<boolean>;
  finish(id: string, result: ConversationProcessResult): Promise<void>;
  associateEffects(
    id: string,
    learning: ConversationProcessResult["learning"],
  ): Promise<ConversationProcessResult>;
  reserveReply(
    id: string,
    result: ConversationProcessResult,
    comments: ConversationSnapshot["replyComments"],
  ): Promise<boolean>;
  publication(
    receipt: ConversationPublicationReceipt,
  ): Promise<ConversationProcessResult>;
  claimPublication(id: string, bodyDigest: string): Promise<boolean>;
  withdrawPublication(id: string): Promise<void>;
}
export type ConversationPolicy = {
  readonly revision: string;
  readonly automaticLearning: boolean;
  readonly requireConfirmation: boolean;
  readonly discussionReplies: boolean;
  readonly contextWindowTokens: number;
  /** Qualified conservative upper bound; byte size alone never proves token fit. */
  readonly tokensPerByteUpperBound: number;
  readonly maxInputBytes: number;
  readonly inference: TextInferencePort;
  readonly bindingManifest: Readonly<Record<string, unknown>>;
  isCurrent(controls: RequestControls): Promise<boolean>;
};
export interface ConversationPolicyPort {
  capture(
    identity: ConversationIdentity,
    processingId: string,
    controls: RequestControls,
  ): Promise<ConversationPolicy>;
}
export type ConversationMemoryContext = {
  readonly text: string;
  readonly manifest: Readonly<Record<string, unknown>>;
  admit(controls: RequestControls): Promise<boolean>;
};
export interface ConversationMemoryPort {
  context(
    snapshot: ConversationSnapshot,
    controls: RequestControls,
  ): Promise<ConversationMemoryContext>;
  learn(
    snapshot: ConversationSnapshot,
    processingId: string,
    policyRevision: string,
    controls: RequestControls,
  ): Promise<
    ConversationProcessResult["learning"] & {
      readonly proposals?: readonly string[];
    }
  >;
  action(
    snapshot: ConversationSnapshot,
    processingId: string,
    intent: ConversationAction,
    controls: RequestControls,
  ): Promise<{
    readonly notice: string;
    readonly effectIds: readonly string[];
    readonly status?: string;
  }>;
}
export type { ConversationAction } from "../../domain/conversation.js";
