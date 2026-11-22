import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { assertInstalledConversationSdk } from "./conversation-sdk-identity.js";

it("binds the active SDK receipt to its manifest and exact bytes while rejecting historical identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "rr-conversation-sdk-identity-"));
  const archive =
    "agent-teams-account-gateway-0.1.0-native-parity-83c18fd090e7.tgz";
  const provenancePath = "vendor/account-gateway/provenance.json";
  const bytes = Buffer.from("controlled archive integrity fixture");
  const provenance = {
    contract: "native-provider-parity-sdk-provenance/v1",
    archive,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const manifest = (filename: string) => ({
    dependencies: {
      "@agent-teams/account-gateway": `file:../../vendor/account-gateway/${filename}`,
    },
  });
  const writeJson = (path: string, value: unknown) =>
    writeFile(join(root, path), JSON.stringify(value));
  try {
    await mkdir(join(root, "apps/api"), { recursive: true });
    await mkdir(join(root, "vendor/account-gateway"), { recursive: true });
    await writeJson(provenancePath, provenance);
    await writeJson("apps/api/package.json", manifest(archive));
    await writeFile(join(root, "vendor/account-gateway", archive), bytes);
    await expect(
      assertInstalledConversationSdk(root, provenancePath),
    ).resolves.toBeUndefined();

    for (const historical of [
      { ...provenance, contract: "native-account-info-sdk-provenance/v1" },
      {
        ...provenance,
        archive:
          "agent-teams-account-gateway-0.1.0-native-imports-f2690a3c9cfd.tgz",
      },
      { ...provenance, contract: "nvidia-sandbox-sdk-provenance/v1" },
      {
        ...provenance,
        archive: "agent-teams-account-gateway-0.1.0-nvidia-0c68a5d544ff.tgz",
      },
    ]) {
      await writeJson(provenancePath, historical);
      await expect(
        assertInstalledConversationSdk(root, provenancePath),
      ).rejects.toThrow("conversation_sdk_provenance_invalid");
    }
    await writeJson(provenancePath, provenance);
    await writeJson("apps/api/package.json", manifest("different-archive.tgz"));
    await expect(
      assertInstalledConversationSdk(root, provenancePath),
    ).rejects.toThrow("conversation_sdk_manifest_mismatch");

    await writeJson("apps/api/package.json", manifest(archive));
    await writeFile(
      join(root, "vendor/account-gateway", archive),
      "changed archive bytes",
    );
    await expect(
      assertInstalledConversationSdk(root, provenancePath),
    ).rejects.toThrow("conversation_sdk_archive_integrity_mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
