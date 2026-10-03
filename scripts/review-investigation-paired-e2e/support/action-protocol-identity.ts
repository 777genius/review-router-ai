import { readFile } from "node:fs/promises";
import path from "node:path";

export async function readActionProtocolIdentity(
  actionSourceDir: string,
): Promise<{
  schemaDigest: string;
  canonicalizerDigest: string;
}> {
  const value: unknown = JSON.parse(
    await readFile(
      path.join(
        actionSourceDir,
        "src/control-plane/generated/review-action-v2/manifest.json",
      ),
      "utf8",
    ),
  );
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("paired_action_protocol_manifest_invalid");
  }
  const manifest = value as Record<string, unknown>;
  const schemaDigest = manifest.schemaDigest;
  const canonicalizerDigest = manifest.canonicalizerDigest;
  if (
    manifest.protocolVersion !== "2" ||
    typeof schemaDigest !== "string" ||
    typeof canonicalizerDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(schemaDigest) ||
    !/^[a-f0-9]{64}$/u.test(canonicalizerDigest)
  ) {
    throw new Error("paired_action_protocol_manifest_invalid");
  }
  return { schemaDigest, canonicalizerDigest };
}
