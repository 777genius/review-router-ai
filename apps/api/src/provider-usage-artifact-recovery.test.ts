import { describe, it, expect, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import Fastify from "fastify";
import {
  readUsageArtifactZip,
  ProviderUsageArtifactReader,
  registerProviderUsageRecovery,
} from "./provider-usage-artifact-recovery.js";

// ZIP fixture written independently of the reader, including actual DEFLATE bytes.
function zip(
  name = "report.json",
  payload = Buffer.from('{"schemaVersion":1}'),
) {
  const encoded = Buffer.from(name),
    compressed = deflateRawSync(payload);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(encoded.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(encoded.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + encoded.length, 12);
  end.writeUInt32LE(local.length + encoded.length + compressed.length, 16);
  return Buffer.concat([local, encoded, compressed, central, encoded, end]);
}
describe("usage artifact recovery", () => {
  it("reads the bounded signed-report container without extracting files", () => {
    expect(readUsageArtifactZip(zip())).toEqual({ schemaVersion: 1 });
  });
  it("rejects traversal, extra files, corruption and decompression bombs", () => {
    expect(() => readUsageArtifactZip(zip("../report.json"))).toThrow(
      "usage_artifact_invalid",
    );
    const multiple = zip();
    multiple.writeUInt16LE(2, multiple.length - 12);
    expect(() => readUsageArtifactZip(multiple)).toThrow(
      "usage_artifact_invalid",
    );
    const corrupt = zip();
    corrupt[45] = (corrupt[45] ?? 0) ^ 0xff;
    expect(() => readUsageArtifactZip(corrupt)).toThrow();
    expect(() =>
      readUsageArtifactZip(zip("report.json", Buffer.alloc(1024 * 1024 + 1))),
    ).toThrow("usage_artifact_invalid");
  });
  it("downloads only the exact completed numeric repository/run attempt artifact", async () => {
    const request = vi.fn(async (route: string) => ({
      data: route.includes("/attempts/")
        ? {
            id: 12,
            run_attempt: 2,
            status: "completed",
            repository: { id: 34 },
          }
        : route.endsWith("/artifacts")
          ? {
              artifacts: [
                {
                  id: 56,
                  name: "reviewrouter-usage-v1-inv-2",
                  expired: false,
                  size_in_bytes: 150,
                  workflow_run: { id: 12, repository_id: 34 },
                },
              ],
            }
          : zip(),
    }));
    const reader = new ProviderUsageArtifactReader({
      app: { getInstallationOctokit: async () => ({ request }) },
    });
    expect(
      await reader.read({
        installationId: "1",
        repositoryId: "34",
        repositoryFullName: "owner/repo",
        runId: "12",
        runAttempt: 2,
        invocationId: "inv",
      }),
    ).toMatchObject({ body: { schemaVersion: 1 } });
    expect(request).toHaveBeenCalledTimes(3);
    await expect(
      reader.read({
        installationId: "1",
        repositoryId: "999",
        repositoryFullName: "owner/repo",
        runId: "12",
        runAttempt: 2,
        invocationId: "inv",
      }),
    ).rejects.toThrow("usage_artifact_invalid");
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("starts maintenance through Fastify lifecycle and awaits shutdown", async () => {
    const app = Fastify();
    const runBatch = vi.fn(async () => ({ recovered: 1 }));
    registerProviderUsageRecovery(app, { runBatch });
    await app.ready();
    await app.close();
    expect(runBatch).toHaveBeenCalledOnce();
  });
});
