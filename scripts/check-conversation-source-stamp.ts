import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conversationSourceFiles } from "../packages/platform/config/src/conversation-source-files.ts";

export const conversationSourceStampPath =
  "packages/platform/config/src/conversation-source-stamp.json";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Source identity must describe the actual installed API SDK, not an older
 * quota-only archive. Archive changes without provenance cannot retain evidence. */
async function assertInstalledConversationSdk(sourceRoot: string) {
  const provenance = JSON.parse(
    await readFile(
      join(sourceRoot, conversationSourceFiles.gatewaySdkProvenanceDigest),
      "utf8",
    ),
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

/** Source coherence metadata only. No model result, proof, scope or permission. */
export async function currentConversationSourceStamp(sourceRoot: string) {
  await assertInstalledConversationSdk(sourceRoot);
  const sourceProfile = {} as Record<
    keyof typeof conversationSourceFiles,
    string
  >;
  for (const key of Object.keys(
    conversationSourceFiles,
  ) as (keyof typeof conversationSourceFiles)[])
    sourceProfile[key] = createHash("sha256")
      .update(await readFile(join(sourceRoot, conversationSourceFiles[key])))
      .digest("hex");
  return { kind: "reviewrouter-conversation-source-stamp/v1", sourceProfile };
}

export async function checkConversationSourceStamp(
  sourceRoot: string,
): Promise<void> {
  const expected = await currentConversationSourceStamp(sourceRoot);
  let actual: unknown;
  try {
    actual = JSON.parse(
      await readFile(join(sourceRoot, conversationSourceStampPath), "utf8"),
    ) as unknown;
  } catch {
    throw new Error("conversation_source_stamp_missing_or_invalid");
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("conversation_source_stamp_stale");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--check", "--write"].includes(args[0]!))
      throw new Error("usage_check_conversation_source_stamp_check_or_write");
    if (args[0] === "--write")
      await writeFile(
        join(root, conversationSourceStampPath),
        JSON.stringify(await currentConversationSourceStamp(root), null, 2) +
          "\n",
      );
    else await checkConversationSourceStamp(root);
    console.log(
      "Conversation source stamp coherent; metadata is not qualification.",
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "conversation_source_stamp_failed",
    );
    process.exitCode = 1;
  }
}
