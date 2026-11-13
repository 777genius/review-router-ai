import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
/** Source identity must describe the actual installed API SDK, not an older
 * quota-only archive. Archive changes without provenance cannot retain evidence. */
export async function assertInstalledConversationSdk(
  sourceRoot: string,
  provenancePath: string,
) {
  const provenance = JSON.parse(
    await readFile(join(sourceRoot, provenancePath), "utf8"),
  ) as { contract?: string; archive?: string; sha256?: string };
  if (
    provenance.contract !== "nvidia-sandbox-sdk-provenance/v1" ||
    !provenance.archive ||
    !/^agent-teams-account-gateway-0[.]1[.]0-nvidia-[a-f0-9]+[.]tgz$/.test(
      provenance.archive,
    ) ||
    !provenance.sha256 ||
    !/^[a-f0-9]{64}$/.test(provenance.sha256)
  )
    throw new Error("conversation_sdk_provenance_invalid");
  const manifest = JSON.parse(
    await readFile(join(sourceRoot, "apps/api/package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  if (
    manifest.dependencies?.["@agent-teams/account-gateway"] !==
    `file:../../vendor/account-gateway/${provenance.archive}`
  )
    throw new Error("conversation_sdk_manifest_mismatch");
  const archive = await readFile(
    join(sourceRoot, "vendor/account-gateway", provenance.archive),
  );
  if (createHash("sha256").update(archive).digest("hex") !== provenance.sha256)
    throw new Error("conversation_sdk_archive_integrity_mismatch");
}
