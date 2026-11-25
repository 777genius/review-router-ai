import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { validateV3ManifestProposal } from "../application/v3-approved-manifest.ts";
import {
  G1OperatorCredentialAuthenticator,
  hashG1OperatorCredential,
  PrismaG1OperatorCredentialReader,
} from "../infrastructure/prisma/prisma-operator-credential.ts";
import { PrismaG1V3ApprovedManifestCommand } from "../infrastructure/prisma/prisma-v3-approved-manifest.ts";
import {
  proposal,
  scope,
  toolId,
  wire,
} from "./v3-approved-manifest.fixture.ts";

const packageRoot = process.env.EF_V3_CANDIDATE_PACKAGE_ROOT;
const archivePath = process.env.EF_V3_CANDIDATE_ARCHIVE;
const sourceCommit = process.env.EF_V3_CANDIDATE_SOURCE_COMMIT;
const sourceTree = process.env.EF_V3_CANDIDATE_SOURCE_TREE;
const databaseUrl = process.env.SDK_GROWTH_TEST_DATABASE_URL;
assert.ok(packageRoot, "EF_V3_CANDIDATE_PACKAGE_ROOT is required");
assert.ok(archivePath, "EF_V3_CANDIDATE_ARCHIVE is required");
assert.match(sourceCommit ?? "", /^[a-f0-9]{40}$/);
assert.match(sourceTree ?? "", /^[a-f0-9]{40}$/);
assert.ok(databaseUrl, "SDK_GROWTH_TEST_DATABASE_URL is required");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);
assert.equal(packageJson.name, "@agent-teams/engineering-foundation");
assert.equal(packageJson.version, "1.6.1");
const archive = readFileSync(archivePath);
const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sri = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
const { decodeRequest } = await import(
  pathToFileURL(join(packageRoot, "dist/sdk-growth-authority.js")).href
);
assert.equal(typeof decodeRequest, "function");
const PgClient = createRequire(import.meta.url)("pg").Client;

test("packed EF decoder validates exact bytes before protected v3 approval commit", async () => {
  const fixture = proposal();
  fixture.request.binding.tool.archiveDigest = sha256(archive);
  fixture.request.binding.tool.archiveIntegrity = sri;
  const initial = decodeRequest(wire(fixture.request));
  const requestWire = Buffer.from(initial.wire, "utf8");
  const validationEvidenceWire = wire({
    schema: "reviewrouter:g1-v3-request-validation-fixture:1",
    requestWireSha256: sha256(requestWire),
    requestByteLength: requestWire.byteLength,
    toolArtifactId: toolId,
    result: "validated",
  });
  fixture.manifest.ef.binding = initial.value.binding;
  fixture.manifest.ef.contextSelectors = initial.value.contextSelectors;
  fixture.manifest.tool.archiveSha256 = sha256(archive);
  fixture.manifest.tool.archiveSha512Sri = sri;
  fixture.manifest.tool.source = { commit: sourceCommit, tree: sourceTree };
  fixture.manifest.requestWireSha256 = sha256(requestWire);
  fixture.manifest.requestByteLength = requestWire.byteLength;
  fixture.manifest.validationEvidenceSha256 = sha256(validationEvidenceWire);
  fixture.manifest.validationEvidenceByteLength =
    validationEvidenceWire.byteLength;
  const manifestWire = wire(fixture.manifest);
  const accepted = validateV3ManifestProposal(
    { manifestWire, requestWire },
    scope,
    { decodedRequest: initial.value, validationEvidenceWire },
  );

  const schema = `ef_v3_candidate_${randomUUID().replaceAll("-", "")}`;
  const setup = new PgClient({ connectionString: databaseUrl });
  let db;
  await setup.connect();
  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    for (const migration of [
      "000101_sdk_growth_authority",
      "000102_sdk_growth_current_authority",
      "000108_sdk_growth_verifier_assignment",
      "000112_sdk_growth_operator_credential",
      "000113_sdk_growth_approval_ledger",
      "000114_sdk_growth_v3_tool_artifact",
      "000115_sdk_growth_v3_approved_manifest",
    ]) {
      await setup.query(
        readFileSync(
          new URL(
            `../../../../platform/db/prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    db = new PrismaClient({
      adapter: new PrismaPg(
        {
          connectionString: databaseUrl,
          max: 4,
          options: `-c search_path=${schema}`,
        },
        { schema },
      ),
      transactionOptions: { timeout: 20_000 },
    });
    const credentialId = "test_v3_candidate_01";
    const token = `g1.${credentialId}.${Buffer.alloc(32, 51).toString("base64url")}`;
    await db.$executeRaw`
      INSERT INTO "SdkGrowthV3ToolArtifact" (
        "artifactId", "packageName", "packageVersion", "sourceCommit", "sourceTree",
        "installedDistributionDigest", "provenanceKind", "archive", "archiveByteLength",
        "archiveSha256", "archiveSha512Sri"
      ) VALUES (
        ${toolId}, '@agent-teams/engineering-foundation', '1.6.1',
        ${sourceCommit}, ${sourceTree}, ${fixture.manifest.tool.installedDistributionDigest},
        'source-built-fixture', ${archive}, ${archive.byteLength}, ${sha256(archive)}, ${sri}
      )`;
    await db.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${credentialId}, 1, ${hashG1OperatorCredential(token).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, ${scope.pullRequest}, '123', '456',
        'test-issuer', 'test-owner', ARRAY['provision','owner-replacement']::text[]
      )`;
    const adapter = {
      validate: async (inputBytes) => {
        const decoded = decodeRequest(Uint8Array.from(inputBytes));
        return {
          decodedRequest: decoded.value,
          validationEvidenceWire: wire({
            schema: "reviewrouter:g1-v3-request-validation-fixture:1",
            requestWireSha256: sha256(inputBytes),
            requestByteLength: inputBytes.byteLength,
            toolArtifactId: toolId,
            result: "validated",
          }),
        };
      },
    };
    let selected = { manifestWire, requestWire };
    const command = new PrismaG1V3ApprovedManifestCommand(
      db,
      new G1OperatorCredentialAuthenticator(
        new PrismaG1OperatorCredentialReader(db),
      ),
      { load: async () => selected },
      adapter,
    );
    assert.equal(
      await command.approve(
        token,
        scope,
        0n,
        "packed-ef-proposal",
        "provision",
      ),
      1n,
    );
    const key = JSON.stringify([
      scope.tenantId,
      scope.repositoryId,
      scope.pullRequest,
    ]);
    const rows = await db.$queryRaw`
      SELECT m."manifestId", m."manifestWire", m."requestWire", m."requestWireSha256",
             m."validationEvidenceWire", m."toolArtifactId", f."v3ManifestId"
      FROM "SdkGrowthV3ApprovedManifest" m
      JOIN "SdkGrowthApprovalFact" f ON f."scopeKey" = m."scopeKey" AND f."epoch" = m."epoch"
      WHERE m."scopeKey" = ${key} AND m."epoch" = 1`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].manifestId, accepted.manifestId);
    assert.deepEqual(
      Buffer.from(rows[0].manifestWire),
      Buffer.from(manifestWire),
    );
    assert.deepEqual(Buffer.from(rows[0].requestWire), requestWire);
    assert.deepEqual(
      Buffer.from(rows[0].validationEvidenceWire),
      Buffer.from(validationEvidenceWire),
    );
    assert.equal(rows[0].requestWireSha256, sha256(requestWire));
    assert.equal(rows[0].toolArtifactId, toolId);
    assert.equal(rows[0].v3ManifestId, accepted.manifestId);

    const invalidRequest = { ...initial.value, requiredPhases: ["topology"] };
    const invalidWire = wire(invalidRequest);
    const invalidManifest = {
      ...fixture.manifest,
      requestWireSha256: sha256(invalidWire),
      requestByteLength: invalidWire.byteLength,
    };
    selected = {
      manifestWire: wire(invalidManifest),
      requestWire: invalidWire,
    };
    await assert.rejects(
      command.approve(
        token,
        scope,
        1n,
        "invalid-ef-proposal",
        "owner-replacement",
      ),
      /growth-authority-phases-invalid/,
    );
    const count = await db.$queryRaw`
      SELECT count(*)::int AS "count" FROM "SdkGrowthApprovalFact" WHERE "scopeKey" = ${key}`;
    assert.equal(count[0].count, 1);
  } finally {
    await db?.$disconnect();
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
});
