import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfiguredProducerReleaseAttestationRegistry,
  readConfiguredProducerReleaseAttestations,
  reviewRunProducerReleaseAttestationsEnv as inlineKey,
  reviewRunProducerReleaseAttestationsFileEnv as fileKey,
} from "../infrastructure/configured-producer-release-attestation";
import {
  ProducerDistributionKind,
  ReviewCapabilityProfile,
} from "../domain/review-run-control-types";
import { producerReleaseImmutableKey } from "../domain/producer-release";
import { ProducerReleaseAttestationStatus } from "../application/ports/producer-release-attestation-ports";
import { createReviewRunControlTestKit } from "../testing/review-run-control-test-kit";

const directories: string[] = [];
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "producer-registry-"));
  directories.push(directory);
  const path = join(directory, "registry.json");
  const rows = Array.from({ length: 61 }, (_, index) => ({
    producerReleaseId: `release-${index}`,
    distributionKind: ProducerDistributionKind.PublicReusable,
    actionCommitSha: (index + 1).toString(16).padStart(40, "0"),
    runtimeCommitSha: "b".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "a".repeat(64),
    contextGatewayPolicyVersion: "review-context-gateway.v1",
    contextGatewayEntrypointDigest: "b".repeat(64),
    reviewInvestigationCapability: "review_investigation_v1",
    reviewInvestigationCoverageProfileHash: "c".repeat(64),
    reviewInvestigationPolicyHash: "d".repeat(64),
    schemaDigest: "e".repeat(64),
    canonicalizerDigest: "f".repeat(64),
    capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
    protocolLimitsProfileId: "limits-1",
    operationalSloProfileId: "slo-1",
    agentProfiles: Array.from({ length: 6 }, (_, agent) => ({
      profileRef: `ocr-managed-${agent}`,
      agentKind: "ocr",
      binarySha256: "1".repeat(64),
      packageVersion: "1.0.0",
      modelTransports: ["account_gateway", "provider_api"],
      contextGateway: false,
      cancellation: true,
      reviewSkillsVersion: 1,
    })),
  }));
  const raw = JSON.stringify(rows);
  writeFileSync(path, raw, { mode: 0o600 });
  return { directory, path, raw, rows };
}
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("file-backed producer attestation registry", () => {
  it("preserves every normalized profile and immutable release for a 61-row registry larger than an exec env string", async () => {
    const { path, raw } = fixture();
    expect(Buffer.byteLength(raw)).toBeGreaterThan(128 * 1024);
    const inline = readConfiguredProducerReleaseAttestations({
      [inlineKey]: raw,
    });
    const file = readConfiguredProducerReleaseAttestations({ [fileKey]: path });
    expect(file).toEqual(inline);
    expect(file).toHaveLength(61);
    const releases = createReviewRunControlTestKit().store;
    const left = new ConfiguredProducerReleaseAttestationRegistry(
      inline,
      releases,
    );
    const right = new ConfiguredProducerReleaseAttestationRegistry(
      file,
      releases,
    );
    for (const row of inline) {
      const query = {
        actionCommitSha: row.actionCommitSha,
        expectedSchemaDigest: row.schemaDigest,
        expectedCanonicalizerDigest: row.canonicalizerDigest,
      };
      const a = await left.attest(query);
      const b = await right.attest(query);
      expect(b).toEqual(a);
      expect(b.status).toBe(ProducerReleaseAttestationStatus.Attested);
      if (
        a.status === ProducerReleaseAttestationStatus.Attested &&
        b.status === ProducerReleaseAttestationStatus.Attested
      )
        expect(producerReleaseImmutableKey(b.release)).toBe(
          producerReleaseImmutableKey(a.release),
        );
    }
  });

  it("starts a normal reader and its child with only a small file-path env value", () => {
    const { path, raw } = fixture();
    const env: Record<string, string | undefined> = {
      ...process.env,
      [fileKey]: path,
    };
    delete env[inlineKey];
    const module = new URL(
      "../infrastructure/configured-producer-release-attestation.ts",
      import.meta.url,
    ).href;
    const code = `import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {readConfiguredProducerReleaseAttestations as read} from ${JSON.stringify(module)};assert.equal(read(process.env).length,61);assert.equal(process.env[${JSON.stringify(inlineKey)}],undefined);const child=spawnSync(process.execPath,['-e',"process.stdout.write('child-ok')"],{env:process.env,encoding:'utf8'});assert.equal(child.status,0);assert.equal(child.stdout,'child-ok');process.stdout.write('61+child-ok');`;
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code],
      { env, encoding: "utf8", timeout: 10000 },
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe("61+child-ok");
    if (process.platform === "linux") {
      const oversized = spawnSync(process.execPath, ["-e", ""], {
        env: { ...env, [inlineKey]: raw },
      });
      expect(oversized.error).toMatchObject({ code: "E2BIG" });
    }
  });

  it("keeps inline compatibility and rejects ambiguous sources even if one is empty", () => {
    const { path, raw } = fixture();
    expect(
      readConfiguredProducerReleaseAttestations({ [inlineKey]: raw }),
    ).toHaveLength(61);
    for (const inline of [raw, ""])
      expect(() =>
        readConfiguredProducerReleaseAttestations({
          [inlineKey]: inline,
          [fileKey]: path,
        }),
      ).toThrow("producer_release_attestations_sources_conflict");
    expect(() => readConfiguredProducerReleaseAttestations({})).toThrow(
      "producer_release_attestations_env_missing",
    );
  });

  it("rejects missing, relative, directory, symlink, oversized and invalid-UTF8 files without disclosing contents or paths", () => {
    const { path, directory } = fixture();
    const folder = join(directory, "folder");
    mkdirSync(folder);
    const link = join(directory, "link");
    symlinkSync(path, link);
    const oversized = join(directory, "oversized");
    writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1, 32));
    const invalidUtf8 = join(directory, "private-marker");
    writeFileSync(invalidUtf8, Buffer.from([255]));
    for (const invalid of [
      "",
      "relative-private-marker",
      join(directory, "missing-private-marker"),
      folder,
      link,
      oversized,
      invalidUtf8,
    ]) {
      expect(() =>
        readConfiguredProducerReleaseAttestations({ [fileKey]: invalid }),
      ).toThrow(/^producer_release_attestations_file_invalid$/);
    }
  });

  it("uses the same fail-closed JSON and attestation parser for file contents", () => {
    const { path } = fixture();
    writeFileSync(path, '{"private-marker":');
    expect(() =>
      readConfiguredProducerReleaseAttestations({ [fileKey]: path }),
    ).toThrow(/^producer_release_attestations_env_invalid$/);
    writeFileSync(path, '[{"private-marker":"do-not-disclose"}]');
    expect(() =>
      readConfiguredProducerReleaseAttestations({ [fileKey]: path }),
    ).toThrow(/^producer_release_attestation_shape_invalid$/);
  });
});
