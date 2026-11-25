import { createHash } from "node:crypto";
import { canonicalContextJson } from "./context-tools.js";

/** Producer-side broker contract, independent of the native binary version. */
export { contextToolsContract as contextToolsDescriptorV1 } from "@reviewrouter/shared";
import { contextToolsContract as contextToolsDescriptorV1 } from "@reviewrouter/shared";
export const contextToolsDescriptorDigest =
  "sha256:" +
  createHash("sha256")
    .update(canonicalContextJson(contextToolsDescriptorV1))
    .digest("hex");
export type ProducerContextToolsProfile = Readonly<{
  extensionId: "context-tools.v1";
  descriptorDigest: string;
}>;
export function supportsContextToolsV1(
  profile: ProducerContextToolsProfile | null | undefined,
): boolean {
  return (
    profile?.extensionId === contextToolsDescriptorV1.extensionId &&
    profile.descriptorDigest === contextToolsDescriptorDigest
  );
}
