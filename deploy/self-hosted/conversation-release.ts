import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { conversationSourceFiles } from "../../packages/platform/config/src/conversation-source-files.ts";
import { assertInstalledConversationSdk } from "../../packages/platform/config/src/conversation-sdk-identity.ts";
import {
  readConversationQualification,
  conversationSourceProfileMatches,
  type ConversationQualification,
} from "./conversation-verifier.mjs";

/** Release-owned input, never an operator-selected path or generated quality proof. */
export const conversationReleaseArtifact =
  "deploy/self-hosted/conversation-capability.json";
export const conversationReleaseSources = conversationSourceFiles;

export type ConversationEnvironmentTuple = Readonly<{
  qualification: string;
  interactionRuntimeSha: string;
}>;
export type ConversationReleaseResult =
  | {
      readonly status: "available";
      readonly environment: ConversationEnvironmentTuple;
    }
  | {
      readonly status: "unqualified";
      readonly reason:
        | "release_artifact_absent"
        | "release_artifact_invalid"
        | "release_artifact_unreadable"
        | "release_source_unavailable"
        | "release_source_mismatch";
    };

/** Same immutable caller-pin contract as normal provisioning; no repository authority. */
export function validateConversationEnvironmentTuple(
  tuple: ConversationEnvironmentTuple,
): Extract<ConversationQualification, { profileVersion: 2 }> {
  const qualification = readConversationQualification(tuple.qualification);
  if (
    qualification?.profileVersion !== 2 ||
    tuple.interactionRuntimeSha !== qualification.runtimeSha ||
    !conversationSourceProfileMatches(qualification.sourceProfile)
  )
    throw new Error("conversation_release_tuple_invalid");
  return qualification;
}

/** Literal unquoted Compose value: prevent interpolation and inline comments while
 * preserving the exact parsed declaration, including JSON escapes and model names. */
export function conversationQualificationEnvironmentValue(raw: string): string {
  return JSON.stringify(JSON.parse(raw) as unknown).replace(
    /[$#']/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Validate release/code coherence, not model quality. The release owner supplies
 * genuine accepted evidence. No artifact, issuer, signature or proof is minted here. */
export async function readConversationRelease(
  installedSourceRoot: string,
): Promise<ConversationReleaseResult> {
  const path = join(installedSourceRoot, conversationReleaseArtifact);
  let raw: string;
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.size > 131_072)
      return { status: "unqualified", reason: "release_artifact_invalid" };
    raw = await readFile(path, "utf8");
  } catch (error) {
    return {
      status: "unqualified",
      reason:
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
          ? "release_artifact_absent"
          : "release_artifact_unreadable",
    };
  }
  let qualification: Extract<ConversationQualification, { profileVersion: 2 }>;
  try {
    const parsed = readConversationQualification(raw);
    if (parsed?.profileVersion !== 2)
      return { status: "unqualified", reason: "release_artifact_invalid" };
    qualification = parsed;
  } catch {
    return { status: "unqualified", reason: "release_artifact_invalid" };
  }
  for (const key of Object.keys(
    conversationReleaseSources,
  ) as (keyof typeof conversationReleaseSources)[]) {
    try {
      const source = join(installedSourceRoot, conversationReleaseSources[key]);
      if (!(await lstat(source)).isFile())
        return { status: "unqualified", reason: "release_source_unavailable" };
      const digest = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      if (digest !== qualification.sourceProfile[key])
        return { status: "unqualified", reason: "release_source_mismatch" };
    } catch {
      return { status: "unqualified", reason: "release_source_unavailable" };
    }
  }
  // Provenance metadata is insufficient without matching installed archive
  // and API package selection. Fail closed on missing or mismatched bytes.
  try {
    await assertInstalledConversationSdk(installedSourceRoot);
  } catch {
    return { status: "unqualified", reason: "release_source_mismatch" };
  }
  if (!conversationSourceProfileMatches(qualification.sourceProfile))
    return { status: "unqualified", reason: "release_source_mismatch" };
  const environment = {
    qualification: JSON.stringify(qualification),
    interactionRuntimeSha: qualification.runtimeSha,
  };
  validateConversationEnvironmentTuple(environment);
  return { status: "available", environment };
}
