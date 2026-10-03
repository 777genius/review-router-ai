import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readActionProtocolIdentity } from "./action-protocol-identity.js";

const roots: string[] = [];

describe("paired Action protocol identity", () => {
  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("reads the pinned Action checkout's own identity", async () => {
    const root = await createRoot();
    await writeManifest(root, {
      protocolVersion: "2",
      schemaDigest: "1".repeat(64),
      canonicalizerDigest: "2".repeat(64),
    });

    await expect(readActionProtocolIdentity(root)).resolves.toEqual({
      schemaDigest: "1".repeat(64),
      canonicalizerDigest: "2".repeat(64),
    });
  });

  it.each([
    null,
    [],
    {
      protocolVersion: "1",
      schemaDigest: "1".repeat(64),
      canonicalizerDigest: "2".repeat(64),
    },
    {
      protocolVersion: "2",
      schemaDigest: "A".repeat(64),
      canonicalizerDigest: "2".repeat(64),
    },
    {
      protocolVersion: "2",
      schemaDigest: "1".repeat(63),
      canonicalizerDigest: "2".repeat(64),
    },
  ])("rejects malformed or incompatible manifests", async (manifest) => {
    const root = await createRoot();
    await writeManifest(root, manifest);
    await expect(readActionProtocolIdentity(root)).rejects.toThrow(
      "paired_action_protocol_manifest_invalid",
    );
  });

  it("rejects a missing Action manifest", async () => {
    const root = await createRoot();
    await expect(readActionProtocolIdentity(root)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(tmpdir(), "reviewrouter-action-protocol-"),
  );
  roots.push(root);
  return root;
}

async function writeManifest(root: string, manifest: unknown): Promise<void> {
  const directory = path.join(
    root,
    "src/control-plane/generated/review-action-v2",
  );
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify(manifest),
  );
}
