import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  lstat,
  readdir,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextEncoder } from "node:util";
import test from "node:test";
import {
  createEfV3HostTransport,
  createEfV3InstalledInventoryReader,
  efV3RequiredPhases,
} from "../application/ef-v3-host-transport.ts";

const packageRoot = dirname(
  fileURLToPath(
    import.meta.resolve("@agent-teams/engineering-foundation/package.json"),
  ),
);
const installedManifest = JSON.parse(
  await readFile(join(packageRoot, "package.json"), "utf8"),
);
assert.equal(installedManifest.name, "@agent-teams/engineering-foundation");
assert.equal(installedManifest.version, "1.6.0");
// Use cached publication bytes when present. pnpm installs do not populate
// npm's cache, so a cache miss retrieves the exact published archive.
async function pinnedEfArchive() {
  const lock = await readFile(
    new URL("../../../../../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  const integrity = lock.match(
    /'@agent-teams\/engineering-foundation@1\.6\.0':\s*\n\s*resolution: \{integrity: (sha512-[A-Za-z0-9+/=]+)\}/u,
  )?.[1];
  assert.ok(integrity, "pinned EF lockfile integrity missing");
  const hex = Buffer.from(integrity.slice(7), "base64").toString("hex");
  const cacheRoots = process.env.EF_V3_NPM_CACHE
    ? [process.env.EF_V3_NPM_CACHE]
    : [process.env.HOME && join(process.env.HOME, ".npm")].filter(Boolean);
  const archivePaths = process.env.EF_V3_PINNED_TARBALL
    ? [process.env.EF_V3_PINNED_TARBALL]
    : cacheRoots.map((root) =>
        join(
          root,
          "_cacache/content-v2/sha512",
          hex.slice(0, 2),
          hex.slice(2, 4),
          hex.slice(4),
        ),
      );
  let bytes;
  let archivePath;
  for (const path of archivePaths) {
    try {
      bytes = await readFile(path);
      archivePath = path;
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "rr-ef-1.6.0-"));
  let archiveDigest;
  try {
    if (!archivePath) {
      const url =
        "https://registry.npmjs.org/@agent-teams/engineering-foundation/-/engineering-foundation-1.6.0.tgz";
      let response;
      try {
        response = await globalThis.fetch(url, {
          signal: globalThis.AbortSignal.timeout(15000),
        });
      } catch (error) {
        throw new Error(
          `Pinned EF 1.6.0 fetch failed: ${error?.name ?? "network-error"}`,
          { cause: error },
        );
      }
      if (!response.ok)
        throw new Error(
          `Pinned EF 1.6.0 fetch returned HTTP ${response.status}`,
        );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Pinned EF 1.6.0 fetch returned no body");
      const chunks = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 10 * 1024 * 1024)
            throw new Error("Pinned EF 1.6.0 archive exceeds 10 MiB");
          chunks.push(value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        if (error?.message === "Pinned EF 1.6.0 archive exceeds 10 MiB")
          throw error;
        throw new Error(
          `Pinned EF 1.6.0 download failed: ${error?.name ?? "network-error"}`,
          { cause: error },
        );
      }
      bytes = Buffer.concat(chunks, length);
    }
    assert.equal(fingerprint.sha512Integrity(bytes), integrity);
    archiveDigest = wireDigest(bytes);
    assert.equal(
      archiveDigest,
      "sha256:842f81ca68e9c3207a0da967eb599229d4d30ea32cd69a9a1686f2eb240f54eb",
    );
    if (!archivePath) {
      archivePath = join(directory, "published.tgz");
      await writeFile(archivePath, bytes);
    }
    execFileSync("tar", ["-xzf", archivePath, "-C", directory]);
    async function fileRows(root, skipDependencies = false) {
      const rows = [];
      async function visit(relative) {
        for (const name of await readdir(join(root, relative))) {
          if (skipDependencies && relative === "" && name === "node_modules")
            continue;
          const path = relative ? `${relative}/${name}` : name;
          const stat = await lstat(join(root, path));
          if (stat.isDirectory()) await visit(path);
          else {
            assert.ok(stat.isFile(), `nonregular EF package member: ${path}`);
            rows.push(path);
          }
        }
      }
      await visit("");
      return rows.toSorted();
    }
    const archived = join(directory, "package");
    const names = await fileRows(archived);
    assert.equal(names.length, 2559);
    assert.deepEqual(await fileRows(packageRoot, true), names);
    for (const name of names)
      assert.deepEqual(
        await readFile(join(packageRoot, name)),
        await readFile(join(archived, name)),
        `installed EF file differs from pinned tarball: ${name}`,
      );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return { archiveDigest, archiveIntegrity: integrity };
}
const ef = async (path) =>
  import(pathToFileURL(join(packageRoot, "dist", path)).href);
const publicApi = await import(
  pathToFileURL(join(packageRoot, "dist/sdk-growth-authority.js")).href
);
assert.equal(typeof publicApi.createSdkGrowthAuthorityVerifier, "function");
const { ReviewRouterGrowthAuthorityAcl } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/reviewrouter/reviewrouter-growth-authority-acl.js",
);
const { hashGrowthPayload, compareGrowthSurfaces, growthGroupFingerprint } =
  await ef(
    "capabilities/public-api-compatibility/application/policies/compare-growth-surfaces.js",
  );
const {
  growthCanonicalJson,
  normalizeGrowthObservation,
  growthObservationReference,
} = await ef(
  "capabilities/public-api-compatibility/application/policies/normalize-growth-observation.js",
);
const { growthDimensions } = await ef(
  "capabilities/public-api-compatibility/application/model/growth-observation.js",
);
const { growthDecisionDigest } = await ef(
  "capabilities/public-api-compatibility/application/policies/evaluate-growth-admission.js",
);
const {
  growthAuthorityRequestDigest,
  growthAuthorityGrantDigest,
  growthAuthorityCompletionDigest,
  validateGrowthAuthorityBinding,
} = await ef(
  "capabilities/public-api-compatibility/application/policies/validate-growth-authority.js",
);
const { digest: efDigest, object: efObject } = await ef(
  "capabilities/public-api-compatibility/application/policies/validate-growth-authority-primitives.js",
);
const { assertGrowthMetadataRootSources } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/filesystem/growth-metadata-root-sources.js",
);
const { metadataRootObservation } = await ef(
  "capabilities/public-api-compatibility/application/policies/validate-growth-metadata-root.js",
);
const { readContainedRegularFile, pathTraversesSymbolicLink } = await ef(
  "source-inventory/node.js",
);
const { readGrowthInvocation } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/filesystem/growth-invocation.js",
);
const { createWorkspaceInventoryReader } = await ef(
  "workspace-inventory/module.js",
);
const { createWorkspaceGrowthReader } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/filesystem/workspace-growth-reader.js",
);
const { createGrowthObservation } = await ef(
  "capabilities/public-api-compatibility/application/use-cases/observe-sdk-growth.js",
);
const { createPublicApiCompatibilityDependencies } = await ef(
  "capabilities/public-api-compatibility/module.js",
);
const { FilesystemPackageArtifactInventory } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/filesystem/filesystem-package-artifact-inventory.js",
);
const { AjvJsonSchemaReleaseInspector } = await ef(
  "capabilities/contract-json-schema-releases/module.js",
);
const { assertSchema } = await ef("schema-catalog.js");

const fingerprint = {
  sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
  sha512Integrity: (bytes) =>
    `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
};
const d = (value) => `sha256:${value.repeat(64)}`;
const wire = (value) => new TextEncoder().encode(JSON.stringify(value));
const wireDigest = (value) => `sha256:${fingerprint.sha256(value)}`;
const cancellation = { throwIfCancelled() {} };
const now = () => new Date("2026-09-16T11:00:00Z");
function validateHostRequest(raw) {
  growthCanonicalJson(raw);
  growthAuthorityRequestDigest(raw, fingerprint);
}
function validateHostCompletion(raw) {
  growthCanonicalJson(raw);
  const c = efObject(raw, [
    "schemaVersion",
    "kind",
    "grantId",
    "grantDigest",
    "requestDigest",
    "binding",
    "reportDigest",
    "reportByteLength",
    "coverageDigest",
    "phasesDigest",
    "verdict",
    "releaseEligible",
    "publication",
    "promotion",
  ]);
  if (
    c.schemaVersion !== "reviewrouter:sdk-growth-authority:3" ||
    c.kind !== "completion" ||
    c.publication !== "finalized" ||
    typeof c.grantId !== "string" ||
    !c.grantId ||
    !Number.isSafeInteger(c.reportByteLength) ||
    c.reportByteLength < 0 ||
    !["admitted", "rejected", "incomplete"].includes(c.verdict) ||
    typeof c.releaseEligible !== "boolean"
  )
    throw new TypeError("growth-authority-completion-invalid");
  validateGrowthAuthorityBinding(c.binding);
  for (const key of [
    "grantDigest",
    "requestDigest",
    "reportDigest",
    "coverageDigest",
    "phasesDigest",
  ])
    efDigest(c[key]);
  const promotion = efObject(
    c.promotion,
    c.promotion?.kind === "none" ? ["kind"] : ["kind", "planDigest"],
  );
  if (promotion.kind !== "none" && promotion.kind !== "plan")
    throw new TypeError("growth-authority-completion-invalid");
  if (promotion.kind === "plan") efDigest(promotion.planDigest);
  growthAuthorityCompletionDigest(raw, fingerprint);
}

const source = { commit: "1".repeat(40), tree: "2".repeat(40) };
const invocation = {
  repository: "github:123",
  sourceCommit: source.commit,
  sourceTree: source.tree,
  topologyDigest: d("1"),
  lockDigest: d("2"),
  toolchainDigest: d("3"),
  artifactDigests: [d("4")],
  tool: {
    version: "1.6.0",
    artifactDigest: d("5"),
    extractorVersion: "7.58.12",
  },
};
const coverage = (packageName, reason = "observed") => ({
  packageName,
  classification: "governed",
  dimensions: growthDimensions.map((dimension) => ({
    dimension,
    status: dimension === "decision" ? "unavailable" : "complete",
    reasons: [dimension === "decision" ? "s3-pending" : reason],
  })),
});
const observation = (packageName) =>
  normalizeGrowthObservation({
    ...globalThis.structuredClone(invocation),
    contractRevision: "foundation:sdk-growth:c0:5",
    observationVersion: "foundation:sdk-growth:observation:1",
    coverage: [coverage(packageName)],
    entries: [],
  });
function custody(contents) {
  const files = Object.entries(contents)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([path, content]) => ({
      path,
      contentHex: Buffer.from(content).toString("hex"),
    }));
  const archivePayload = growthCanonicalJson({
    schemaVersion: "foundation:sdk-growth:archive:1",
    files,
  });
  const archiveManifest = files.map((file) => ({
    path: file.path,
    digest: wireDigest(Buffer.from(file.contentHex, "hex")),
  }));
  return {
    archivePayload,
    archiveDigest: wireDigest(Buffer.from(archivePayload)),
    archiveIntegrity: fingerprint.sha512Integrity(archivePayload),
    archiveManifest,
    installedFiles: globalThis.structuredClone(archiveManifest),
  };
}
function packed(packageName, packageVersion, content) {
  const observed = observation(packageName);
  const custodyEvidence = custody({
    "package.json": JSON.stringify({
      name: packageName,
      version: packageVersion,
    }),
    "content.txt": content,
  });
  const { archiveDigest, archiveIntegrity } = custodyEvidence;
  const observationDigest = growthObservationReference(
    observed,
    fingerprint,
  ).surfaceDigest;
  return {
    packageName,
    packageVersion,
    source,
    archiveDigest,
    archiveIntegrity,
    observation: observed,
    observationDigest,
    coverage: observed.coverage[0],
    custodyEvidence,
    custodyEvidenceDigest: hashGrowthPayload(
      { domain: "foundation:sdk-growth:custody:1", payload: custodyEvidence },
      fingerprint,
    ),
    installedDistribution: {
      packageName,
      packageVersion,
      source,
      archiveDigest,
      archiveIntegrity,
      observationDigest,
    },
  };
}
function fixture() {
  const base = normalizeGrowthObservation({
    ...globalThis.structuredClone(invocation),
    contractRevision: "foundation:sdk-growth:c0:5",
    observationVersion: "foundation:sdk-growth:observation:1",
    coverage: [
      coverage("a-released"),
      coverage("b-initial"),
      coverage("workspace-root", "qualified-non-release-metadata-root"),
    ],
    entries: [],
  });
  const historical = custody({
    "trusted-base.json": growthCanonicalJson(base),
  });
  const binding = {
    invocation: globalThis.structuredClone(invocation),
    target: {
      repository: {
        provider: "github",
        repositoryId: "123",
        owner: "synthetic",
        name: "sdk-growth",
      },
      pullRequestNumber: 44,
      head: source,
      base: source,
      mergeBase: source,
      evaluation: source,
      evaluationKind: "head",
    },
    verifier: {
      identity: "synthetic/verifier",
      immutableRevision: "7".repeat(40),
      artifactDigest: d("6"),
    },
    tool: {
      packageName: "@agent-teams/engineering-foundation",
      version: "1.6.0",
      archiveDigest: d("7"),
      archiveIntegrity: `sha512-${"A".repeat(86)}==`,
      distributionDigest: d("5"),
      extractorVersion: "7.58.12",
    },
    policy: {
      contractRevision: "foundation:sdk-growth:c0:5",
      policyVersion: "foundation:sdk-growth:policy:1",
      enrollmentRevision: "8".repeat(40),
      configurationDigest: d("8"),
      scopeDigest: d("9"),
      commandDigest: d("a"),
    },
    historyDigest: d("b"),
    evidenceManifestDigest: d("c"),
  };
  const request = {
    schemaVersion: "reviewrouter:sdk-growth-authority:3",
    kind: "request",
    operation: "check",
    admissionReceiptId: null,
    binding,
    contextSelectors: {
      trustedBasePath: "evidence/base.json",
      decisionsPath: "evidence/decisions.json",
      released: [
        {
          packageName: "a-released",
          kind: "released",
          observationPath: "evidence/a.json",
        },
        {
          packageName: "b-initial",
          kind: "initial-unreleased",
          trustedHistoryPath: "evidence/b.json",
        },
      ],
    },
    decisionDigests: [],
    requiredPhases: [...efV3RequiredPhases],
  };
  const rootBytes = growthCanonicalJson({
    schemaVersion: "foundation:sdk-growth:metadata-root:1",
    kind: "non-release-metadata-root",
    packageName: "workspace-root",
    rootPath: ".",
    manifestPath: "package.json",
    decisionId: "ROOT-1",
    ownerRef: "synthetic/owner",
    releaseHistory: "none",
  });
  const rootSource = {
    source,
    manifestBytes: JSON.stringify({ name: "workspace-root", private: true }),
    workspaceBytes: "packages:\n  - pkg\n",
    classificationBytes: rootBytes,
  };
  const root = {
    evidence: {
      kind: "non-release-metadata-root",
      packageName: "workspace-root",
      rootPath: ".",
      manifestPath: "package.json",
      classificationPath: "architecture/metadata-root.json",
      historyDigest: binding.historyDigest,
      base: globalThis.structuredClone(rootSource),
      candidate: globalThis.structuredClone(rootSource),
    },
    evidenceDigest: d("e"),
    ownerEvidence: {
      decisionId: "ROOT-1",
      ownerRef: "synthetic/owner",
      decisionDigest: d("e"),
      authenticatedSubjectId: "synthetic-owner",
      authorizationEvidenceDigest: d("2"),
      approvalEvidenceDigest: d("3"),
      sourceBindingDigest: d("4"),
    },
  };
  const archive = packed("a-released", "0.9.0", "old");
  const candidateA = packed("a-released", "1.0.0", "new");
  const candidateB = packed("b-initial", "0.0.0", "first");
  const snapshot = {
    schemaVersion: 1,
    packageName: "a-released",
    packageVersion: "0.9.0",
    extractorVersion: "7.58.12",
    entrypoints: [],
  };
  const grant = {
    schemaVersion: request.schemaVersion,
    kind: "grant",
    grantId: "synthetic-grant",
    requestDigest: d("f"),
    admissionReceipt: { kind: "none" },
    binding,
    workflowRef: "synthetic/workflow",
    runRef: "synthetic/run",
    issuedAt: "2026-09-16T10:00:00Z",
    expiresAt: "2026-09-16T12:00:00Z",
    trustedBase: base,
    trustedBaseReference: growthObservationReference(base, fingerprint),
    retainedHistory: {
      targetSource: source,
      targetSurfaceDigest: growthObservationReference(base, fingerprint)
        .surfaceDigest,
      receiptDigest: d("d"),
      custodyEvidence: historical,
      custodyEvidenceDigest: hashGrowthPayload(
        { domain: "foundation:sdk-growth:custody:1", payload: historical },
        fingerprint,
      ),
    },
    released: [
      {
        packageName: "a-released",
        releaseEvidence: {
          packageName: "a-released",
          packageVersion: "1.0.0",
          declaredBump: "minor",
        },
        observation: archive.observation,
        evidence: {
          kind: "released",
          typed: snapshot,
          artifact: {
            ...snapshot,
            extractorVersion: "package-artifact-inventory/1",
          },
        },
      },
      {
        packageName: "b-initial",
        releaseEvidence: {
          packageName: "b-initial",
          packageVersion: "0.0.0",
          declaredBump: "minor",
        },
        evidence: {
          kind: "initial-unreleased",
          historyDigest: binding.historyDigest,
        },
      },
    ],
    ownerEvidence: [],
    archives: [archive],
    candidates: [candidateA, candidateB],
    metadataRoots: [root],
    requiredCoverageDigest: d("e"),
    requiredPhases: [...efV3RequiredPhases],
  };
  const rootObservation = metadataRootObservation(
    root,
    "base",
    base,
    fingerprint,
  );
  grant.trustedBase = normalizeGrowthObservation({
    ...base,
    coverage: [
      ...base.coverage.filter((row) => row.packageName !== "workspace-root"),
      ...rootObservation.coverage,
    ],
    entries: rootObservation.entries,
  });
  grant.trustedBaseReference = growthObservationReference(
    grant.trustedBase,
    fingerprint,
  );
  grant.retainedHistory.targetSurfaceDigest =
    grant.trustedBaseReference.surfaceDigest;
  grant.retainedHistory.custodyEvidence = custody({
    "trusted-base.json": growthCanonicalJson(grant.trustedBase),
  });
  grant.retainedHistory.custodyEvidenceDigest = hashGrowthPayload(
    {
      domain: "foundation:sdk-growth:custody:1",
      payload: grant.retainedHistory.custodyEvidence,
    },
    fingerprint,
  );
  function seal() {
    root.evidenceDigest = hashGrowthPayload(
      {
        domain: "foundation:sdk-growth:metadata-root:1",
        evidence: root.evidence,
      },
      fingerprint,
    );
    root.ownerEvidence.decisionDigest = root.evidenceDigest;
    binding.evidenceManifestDigest = hashGrowthPayload(
      {
        domain: "foundation:sdk-growth:evidence-manifest:2",
        payload: {
          archives: grant.archives.map((row) => ({
            packageName: row.packageName,
            custodyEvidenceDigest: row.custodyEvidenceDigest,
          })),
          candidates: grant.candidates.map((row) => ({
            packageName: row.packageName,
            custodyEvidenceDigest: row.custodyEvidenceDigest,
          })),
          metadataRoots: [
            {
              packageName: "workspace-root",
              evidenceDigest: root.evidenceDigest,
            },
          ],
          retainedHistory: grant.retainedHistory.custodyEvidenceDigest,
        },
      },
      fingerprint,
    );
    grant.binding = globalThis.structuredClone(binding);
    grant.requestDigest = growthAuthorityRequestDigest(request, fingerprint);
    root.ownerEvidence.sourceBindingDigest = grant.requestDigest;
  }
  seal();
  // This synthetic installation is captured before any producer-wire mutation.
  // The inventory port must never derive observed bytes from a later grant.
  const installations = new Map(
    [...grant.archives, ...grant.candidates].map((row) => [
      row.archiveDigest,
      {
        identity: {
          packageName: row.packageName,
          packageVersion: row.packageVersion,
          archiveDigest: row.archiveDigest,
          archiveIntegrity: row.archiveIntegrity,
          source: row.source,
        },
        files: JSON.parse(row.custodyEvidence.archivePayload).files.map(
          (file) => ({
            path: file.path,
            bytes: Buffer.from(file.contentHex, "hex"),
          }),
        ),
      },
    ]),
  );
  return { request, grant, root, seal, installations };
}

function harness(
  value,
  installedMutation = (files) => files,
  receiptMutation = (receipt) => receipt,
) {
  const calls = { resolve: 0, complete: 0, inventory: [] };
  const port = {
    async resolve(input) {
      // The host validates the original value and canonicalizes the same value
      // before the first effect. This test host uses EF's exact pinned domain.
      validateHostRequest(input.request);
      calls.resolve++;
      const bytes = wire(value.grant);
      return { wire: bytes, wireDigest: wireDigest(bytes) };
    },
    async complete(input) {
      validateHostCompletion(input.completion);
      calls.complete++;
      const c = input.completion;
      const receipt = {
        schemaVersion: c.schemaVersion,
        kind: "receipt",
        receiptId: "synthetic-receipt",
        grantId: c.grantId,
        grantDigest: c.grantDigest,
        requestDigest: c.requestDigest,
        completionDigest: growthAuthorityCompletionDigest(c, fingerprint),
        binding: c.binding,
        reportDigest: c.reportDigest,
        coverageDigest: c.coverageDigest,
        phasesDigest: c.phasesDigest,
        verdict: c.verdict,
        releaseEligible: c.releaseEligible,
        qualification:
          c.verdict === "admitted" && c.releaseEligible
            ? "qualified"
            : "not-qualified",
        operation: "check",
        promotion: c.promotion,
        custodyRef: "synthetic/receipt",
        issuedAt: now().toISOString(),
      };
      const bytes = wire(receiptMutation(receipt));
      return { wire: bytes, wireDigest: wireDigest(bytes) };
    },
    async readInstalled({ identity }) {
      calls.inventory.push(identity.packageName);
      const installation = value.installations.get(identity.archiveDigest);
      assert.ok(
        installation,
        `Unexpected installed archive ${identity.archiveDigest}`,
      );
      assert.deepEqual(identity, installation.identity);
      return installedMutation(
        installation.files.map((file) => ({
          path: file.path,
          bytes: Buffer.from(file.bytes),
        })),
        identity,
      );
    },
  };
  const acl = new ReviewRouterGrowthAuthorityAcl(
    createEfV3HostTransport(port),
    fingerprint,
    now,
    createEfV3InstalledInventoryReader(port),
  );
  return { acl, calls };
}

function incompleteCompletion(accepted) {
  return {
    schemaVersion: "reviewrouter:sdk-growth-authority:3",
    kind: "completion",
    grantId: accepted.grantId,
    grantDigest: growthAuthorityGrantDigest(accepted, fingerprint),
    requestDigest: accepted.requestDigest,
    binding: accepted.binding,
    reportDigest: d("1"),
    reportByteLength: 12,
    coverageDigest: d("2"),
    phasesDigest: d("3"),
    verdict: "incomplete",
    releaseEligible: false,
    publication: "finalized",
    promotion: { kind: "none" },
  };
}

// Breakage caught: a v3 grant could be narrowed to one archive, invent a release
// archive for the initial package, or drop the root while still yielding a receipt.
test("installed EF 1.6.0 resolves and completes the multi-package v3 contract", async () => {
  const value = fixture();
  const { acl, calls } = harness(value);
  const accepted = await acl.resolve(value.request, cancellation);
  assert.deepEqual(accepted.requiredPhases, efV3RequiredPhases);
  assert.deepEqual(
    accepted.released.map((row) => [row.packageName, row.evidence.kind]),
    [
      ["a-released", "released"],
      ["b-initial", "initial-unreleased"],
    ],
  );
  assert.deepEqual(
    accepted.archives.map((row) => row.packageName),
    ["a-released"],
  );
  assert.deepEqual(
    accepted.candidates.map((row) => row.packageName),
    ["a-released", "b-initial"],
  );
  assert.deepEqual(
    accepted.metadataRoots.map((row) => row.evidence.packageName),
    ["workspace-root"],
  );
  assert.deepEqual(calls.inventory, ["a-released", "a-released", "b-initial"]);
  const completion = incompleteCompletion(accepted);
  const receipt = await acl.complete(completion, cancellation);
  assert.equal(receipt.qualification, "not-qualified");
  assert.equal(
    receipt.completionDigest,
    growthAuthorityCompletionDigest(completion, fingerprint),
  );
  assert.deepEqual(calls, {
    resolve: 1,
    complete: 1,
    inventory: ["a-released", "a-released", "b-initial"],
  });
});

// Breakage caught: a host receipt cannot upgrade an incomplete report into
// qualified authority by changing only its qualification field.
test("incomplete completion rejects a forged qualified receipt", async () => {
  const value = fixture();
  const { acl } = harness(
    value,
    (files) => files,
    (receipt) => ({ ...receipt, qualification: "qualified" }),
  );
  const accepted = await acl.resolve(value.request, cancellation);
  await assert.rejects(
    acl.complete(incompleteCompletion(accepted), cancellation),
    /growth-authority-qualification-mismatch/,
  );
});

// Breakage caught: an older envelope could be accepted as a v3 grant.
test("v1 substitution is rejected before any installed read", async () => {
  const value = fixture();
  value.grant.schemaVersion = "reviewrouter:sdk-growth-authority:1";
  const { acl, calls } = harness(value);
  await assert.rejects(
    acl.resolve(value.request, cancellation),
    /ef-v3-response-invalid/,
  );
  assert.deepEqual(calls.inventory, []);
});

// Breakage caught: v1 requests must be rejected by the host before effects.
test("v1 request substitution is rejected before host effects", async () => {
  const value = fixture();
  value.request.schemaVersion = "reviewrouter:sdk-growth-authority:1";
  const { acl, calls } = harness(value);
  await assert.rejects(
    acl.resolve(value.request, cancellation),
    /growth-authority-request-invalid/,
  );
  assert.equal(calls.resolve, 0);
});

// Breakage caught: reserializing an authenticated host response could change
// its retained wire bytes while leaving its parsed EF claims unchanged.
test("transport preserves the exact host grant wire", async () => {
  const value = fixture();
  const expected = wire(value.grant);
  const host = {
    async resolve() {
      return { wire: expected, wireDigest: wireDigest(expected) };
    },
    async complete() {
      throw new Error("unexpected completion");
    },
    async readInstalled() {
      throw new Error("unexpected installed read");
    },
  };
  const received = await createEfV3HostTransport(host).resolve(value.request);
  assert.deepEqual(received, expected);
});

// Breakage caught: a candidate-origin owner claim or replacement retained history
// could be accepted after recomputing a superficial request digest.
for (const [name, mutate, expectedError] of [
  [
    "forged owner",
    (value) => {
      value.root.ownerEvidence.sourceBindingDigest = d("9");
    },
    /growth-metadata-root-owner-evidence-mismatch/,
  ],
  [
    "malformed owner",
    (value) => {
      delete value.root.ownerEvidence.approvalEvidenceDigest;
    },
    /growth-authority-contract-invalid/,
  ],
  [
    "missing owner",
    (value) => {
      delete value.root.ownerEvidence;
    },
    /growth-authority-contract-invalid/,
  ],
  [
    "changed historical bytes",
    (value) => {
      value.grant.retainedHistory.custodyEvidence.archivePayload += " ";
    },
  ],
  [
    "candidate-forged retained history",
    (value) => {
      const history = value.grant.retainedHistory;
      history.custodyEvidence = custody({ "trusted-base.json": "{}" });
      history.custodyEvidenceDigest = hashGrowthPayload(
        {
          domain: "foundation:sdk-growth:custody:1",
          payload: history.custodyEvidence,
        },
        fingerprint,
      );
      value.seal();
    },
  ],
  [
    "missing package coverage",
    (value) => {
      value.grant.trustedBase.coverage =
        value.grant.trustedBase.coverage.filter(
          (row) => row.packageName !== "b-initial",
        );
    },
  ],
])
  test(`${name} fails at EF grant validation`, async () => {
    const value = fixture();
    mutate(value);
    const { acl, calls } = harness(value);
    await assert.rejects(
      acl.resolve(value.request, cancellation),
      expectedError ?? /growth-/,
    );
    if (expectedError !== undefined) assert.deepEqual(calls.inventory, []);
  });

// Breakage caught: the candidate archive or an independently installed byte
// could change while retaining the producer's claimed digest.
for (const name of ["archive bytes", "installed bytes"])
  test(`${name} fails at EF custody validation`, async () => {
    const value = fixture();
    if (name === "archive bytes")
      value.grant.candidates[0].custodyEvidence.archivePayload += " ";
    const installedMutation = (files, identity) =>
      name === "installed bytes" && identity.packageName === "b-initial"
        ? files.map((row, index) =>
            index === 0 ? { ...row, bytes: Buffer.from("changed") } : row,
          )
        : files;
    const { acl, calls } = harness(value, installedMutation);
    await assert.rejects(acl.resolve(value.request, cancellation), /growth-/);
    assert.equal(calls.complete, 0);
  });

// Breakage caught: authenticated metadata bytes could disagree with committed
// source or the candidate working tree after the grant was issued.
test("EF rejects mismatched metadata root source bytes", async () => {
  const value = fixture();
  const directory = await mkdtemp(join(process.cwd(), ".rr-ef-v3-root-"));
  try {
    await mkdir(join(directory, "architecture"));
    await writeFile(
      join(directory, "package.json"),
      value.root.evidence.candidate.manifestBytes,
    );
    await writeFile(
      join(directory, "pnpm-workspace.yaml"),
      value.root.evidence.candidate.workspaceBytes,
    );
    await writeFile(
      join(directory, "architecture/metadata-root.json"),
      value.root.evidence.candidate.classificationBytes,
    );
    const git = (args) =>
      execFileSync("git", args, { cwd: directory, encoding: "utf8" });
    git(["init", "--quiet"]);
    git(["add", "."]);
    git([
      "-c",
      "user.name=Synthetic",
      "-c",
      "user.email=synthetic@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "fixture",
    ]);
    const exact = {
      commit: git(["rev-parse", "HEAD"]).trim(),
      tree: git(["rev-parse", "HEAD^{tree}"]).trim(),
    };
    value.root.evidence.base.source = exact;
    value.root.evidence.candidate.source = exact;
    const verify = () =>
      assertGrowthMetadataRootSources(
        [value.root],
        directory,
        {
          files: { read: readContainedRegularFile },
          async runGit(args) {
            return { exitCode: 0, stdout: git(args) };
          },
        },
        cancellation,
      );
    await verify();
    await writeFile(join(directory, "architecture/metadata-root.json"), "{}");
    await assert.rejects(
      verify(),
      /growth-metadata-root-working-bytes-mismatch/,
    );
    await writeFile(
      join(directory, "architecture/metadata-root.json"),
      value.root.evidence.candidate.classificationBytes,
    );
    value.root.evidence.base.workspaceBytes += "  - forged\n";
    await assert.rejects(
      verify(),
      /growth-metadata-root-source-bytes-mismatch/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// The adapter deliberately does not claim an EF type. A host must reject the
// exact EF canonical domain and full request contract before its first effect.
for (const [name, mutate] of [
  [
    "array hole",
    (request) => {
      request.decisionDigests = new Array(1);
    },
  ],
  [
    "non-NFC Unicode",
    (request) => {
      request.binding.target.repository.owner = "e\u0301";
    },
  ],
  [
    "fractional number",
    (request) => {
      request.binding.target.pullRequestNumber = 44.5;
    },
  ],
  [
    "extra array property",
    (request) => {
      request.decisionDigests.extra = "surprise";
    },
  ],
  [
    "changing getter",
    (request) => {
      let reads = 0;
      Object.defineProperty(request, "operation", {
        enumerable: true,
        get() {
          return ++reads === 1 ? "check" : "promote-release";
        },
      });
    },
  ],
  [
    "missing binding field",
    (request) => {
      delete request.binding.historyDigest;
    },
  ],
  [
    "invalid binding digest",
    (request) => {
      request.binding.historyDigest = "sha256:bad";
    },
  ],
])
  test(`host rejects ${name} before effects`, async () => {
    const request = fixture().request;
    mutate(request);
    let effects = 0;
    const host = {
      async resolve({ request: raw }) {
        validateHostRequest(raw);
        effects++;
        throw new Error("unexpected effect");
      },
      async complete() {
        throw new Error("unexpected completion");
      },
      async readInstalled() {
        throw new Error("unexpected inventory");
      },
    };
    await assert.rejects(
      createEfV3HostTransport(host).resolve(request),
      /growth-|invalid-/,
    );
    assert.equal(effects, 0);
  });

test("host rejects malformed completion before effects", async () => {
  const completion = incompleteCompletion(fixture().grant);
  completion.reportDigest = "sha256:bad";
  let effects = 0;
  const host = {
    async resolve() {
      throw new Error("unexpected resolve");
    },
    async complete({ completion: raw }) {
      validateHostCompletion(raw);
      effects++;
      throw new Error("unexpected effect");
    },
    async readInstalled() {
      throw new Error("unexpected inventory");
    },
  };
  await assert.rejects(
    createEfV3HostTransport(host).complete(completion),
    /growth-|invalid-/,
  );
  assert.equal(effects, 0);
});

test("host rejects missing completion field before effects", async () => {
  const completion = incompleteCompletion(fixture().grant);
  delete completion.coverageDigest;
  let effects = 0;
  const host = {
    async resolve() {
      throw new Error("unexpected resolve");
    },
    async complete({ completion: raw }) {
      validateHostCompletion(raw);
      effects++;
      throw new Error("unexpected effect");
    },
    async readInstalled() {
      throw new Error("unexpected inventory");
    },
  };
  await assert.rejects(
    createEfV3HostTransport(host).complete(completion),
    /growth-/,
  );
  assert.equal(effects, 0);
});

// The producer is deliberately limited to this fixture's complete grammar. Its
// empty censuses are conclusions from actual bytes, never default coverage flags.
async function typeOnlyWitness(packageRoot, archiveMembers, expectedSymbols) {
  const names = (await readdir(packageRoot)).toSorted();
  assert.deepEqual(names, ["index.d.ts", "package.json", "tsconfig.json"]);
  const files = new Map();
  for (const name of names) {
    const path = join(packageRoot, name);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.nlink !== 1)
      throw new Error("producer-nonregular-member");
    files.set(name, await readFile(path));
  }
  if (archiveMembers !== undefined) {
    assert.deepEqual([...archiveMembers.keys()].toSorted(), names);
    for (const name of names)
      assert.deepEqual(archiveMembers.get(name), files.get(name));
  }
  const manifest = JSON.parse(files.get("package.json").toString());
  const expectedManifest = {
    name: "b-initial",
    version: "0.0.0",
    exports: { ".": { types: "./index.d.ts" } },
  };
  assert.deepEqual(manifest, expectedManifest);
  assert.equal(
    files.get("package.json").toString(),
    JSON.stringify(expectedManifest),
  );
  const expectedTsconfig = {
    compilerOptions: { declaration: true, emitDeclarationOnly: true },
  };
  assert.deepEqual(
    JSON.parse(files.get("tsconfig.json").toString()),
    expectedTsconfig,
  );
  assert.equal(
    files.get("tsconfig.json").toString(),
    JSON.stringify(expectedTsconfig),
  );
  const declaration = files.get("index.d.ts").toString("utf8");
  const lines = declaration.trimEnd().split("\n");
  assert.deepEqual(
    lines,
    expectedSymbols.map(([name, type]) => `export type ${name} = ${type};`),
  );
  for (const line of lines)
    if (!/^export type [A-Za-z]+ = (number|string);$/.test(line))
      throw new Error("producer-unknown-declaration-form");
  return Object.freeze({
    manifestBytes: files.get("package.json"),
    declarationBytes: files.get("index.d.ts"),
    declarationCensus: expectedSymbols.map(([name, type]) => ({ name, type })),
    referenceEdges: [],
    runtimeTargets: [],
    bins: [],
    data: [],
    wildcards: [],
    archiveMembers: archiveMembers === undefined ? null : names,
  });
}

function completeTypeOnlyObservation(local, witness, bootstrapHistory = null) {
  if (witness.archiveMembers === null) {
    if (
      bootstrapHistory?.releaseHistory !== "initial-unreleased" ||
      bootstrapHistory.approved !== true
    )
      throw new Error("producer-base-history-unavailable");
  } else {
    assert.deepEqual(witness.archiveMembers, [
      "index.d.ts",
      "package.json",
      "tsconfig.json",
    ]);
  }
  assert.equal(local.surface.status, "available");
  const row = local.surface.value.coverage.find(
    (item) => item.packageName === "b-initial",
  );
  assert.ok(row);
  const entries = local.surface.value.entries.filter(
    (item) => item.coordinate.packageName === "b-initial",
  );
  const typed = entries.filter(
    (item) => item.coordinate.subject.kind === "typed",
  );
  const snapshot = local.compatibilitySnapshots.find(
    (item) => item.packageName === "b-initial",
  )?.typed.snapshot;
  assert.equal(snapshot.status, "available");
  const expectedItems = witness.declarationCensus
    .map(({ name, type }) => ({
      canonicalReference: `b-initial!${name}:type`,
      kind: "TypeAlias",
      parentReference: "b-initial!",
      parentKind: "EntryPoint",
      signature: `export type ${name} = ${type};`,
    }))
    .toSorted((a, b) => (a.canonicalReference < b.canonicalReference ? -1 : 1));
  assert.deepEqual(snapshot.value.entrypoints, [
    { exportPath: ".", items: expectedItems },
  ]);
  for (const entry of typed) {
    const item = expectedItems.find(
      (candidate) =>
        candidate.canonicalReference ===
        entry.coordinate.subject.canonicalReference,
    );
    assert.ok(item);
    assert.equal(
      entry.value.digest,
      wireDigest(Buffer.from(growthCanonicalJson(item))),
    );
  }
  assert.equal(typed.length, witness.declarationCensus.length);
  assert.deepEqual(
    typed.map((item) => item.coordinate.subject.canonicalReference).toSorted(),
    witness.declarationCensus
      .map((item) => `b-initial!${item.name}:type`)
      .toSorted(),
  );
  assert.equal(
    entries.filter((item) => item.coordinate.subject.kind === "package").length,
    1,
  );
  const branches = entries.filter(
    (item) => item.coordinate.subject.kind === "export-branch",
  );
  assert.equal(branches.length, 1);
  assert.deepEqual(branches[0].coordinate, {
    packageName: "b-initial",
    exportPath: ".",
    resolutionBranch: [],
    subject: { kind: "export-branch" },
  });
  assert.equal(
    branches[0].value.digest,
    wireDigest(
      Buffer.from(
        growthCanonicalJson({
          kind: "conditions",
          entries: [
            {
              condition: "types",
              value: { kind: "target", target: "./index.d.ts" },
            },
          ],
        }),
      ),
    ),
  );
  assert.equal(entries.length, typed.length + 2);
  assert.deepEqual(witness.referenceEdges, []);
  assert.deepEqual(witness.runtimeTargets, []);
  assert.deepEqual(witness.bins, []);
  assert.deepEqual(witness.data, []);
  assert.deepEqual(witness.wildcards, []);
  return normalizeGrowthObservation({
    ...local.surface.value,
    coverage: [
      {
        ...row,
        dimensions: growthDimensions.map((dimension) => ({
          dimension,
          status: dimension === "decision" ? "unavailable" : "complete",
          reasons: [
            dimension === "decision"
              ? "s1-owner-pending"
              : dimension === "packed" && bootstrapHistory !== null
                ? "checked-initial-unreleased-bootstrap"
                : "checked-type-only-source-and-archive",
          ],
        })),
      },
    ],
    entries,
  });
}

// This test ends at validation of an in-memory synthetic check receipt.
test("public v3 qualifyCheck admits a checked disposable type-only SDK", async () => {
  const pinnedTool = await pinnedEfArchive();
  const directory = await mkdtemp(join(process.cwd(), ".rr-sdk-v3-public-"));
  const root = join(directory, "source");
  const packageRoot = join(root, "packages/b-initial");
  const install = join(directory, "installed", "b-initial");
  const archivePath = join(directory, "b-initial.tgz");
  const git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const checkpoint = (message) => {
    git(["add", "."]);
    git([
      "-c",
      "user.name=Synthetic owner",
      "-c",
      "user.email=owner@example.invalid",
      "commit",
      "--quiet",
      "-m",
      message,
    ]);
  };
  const put = async (path, contents) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  };
  const sourceIdentity = () => ({
    commit: git(["rev-parse", "HEAD"]),
    tree: git(["rev-parse", "HEAD^{tree}"]),
  });
  const archiveMembers = (path) => {
    const names = execFileSync("tar", ["-tzf", path], { encoding: "utf8" })
      .trim()
      .split("\n");
    const details = execFileSync("tar", ["-tvzf", path], { encoding: "utf8" })
      .trim()
      .split("\n");
    const members = new Map();
    for (const [index, name] of names.entries()) {
      if (name === "./") continue;
      if (name.endsWith("/")) throw new Error("nonregular-archive-member");
      if (!name.startsWith("./") || details[index]?.[0] !== "-")
        throw new Error("nonregular-archive-member");
      const member = name.slice(2);
      if (
        !member ||
        member.includes("..") ||
        members.has(member) ||
        [...members.keys()].some(
          (item) => item.toLowerCase() === member.toLowerCase(),
        )
      )
        throw new Error("unsafe-archive-member");
      members.set(member, execFileSync("tar", ["-xOf", path, name]));
    }
    return members;
  };
  try {
    await mkdir(root);
    await put(
      "package.json",
      JSON.stringify({ name: "workspace-root", private: true }),
    );
    await put("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
    await put("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
    await put(
      "packages/b-initial/package.json",
      JSON.stringify({
        name: "b-initial",
        version: "0.0.0",
        exports: { ".": { types: "./index.d.ts" } },
      }),
    );
    await put(
      "packages/b-initial/index.d.ts",
      "export type Marker = number;\n",
    );
    await put(
      "packages/b-initial/tsconfig.json",
      JSON.stringify({
        compilerOptions: { declaration: true, emitDeclarationOnly: true },
      }),
    );
    await put(
      ".changeset/first.md",
      '---\n"b-initial": minor\n---\n\nSynthetic first release.\n',
    );
    await put(
      "architecture/decisions/accepted-decisions.json",
      JSON.stringify({ schemaVersion: 1, algorithm: "sha256", decisions: [] }),
    );
    await put(
      "architecture/foundation/governance.yaml",
      "schemaVersion: 1\nadrRoots:\n  - docs/decisions\nindex:\n  path: docs/decisions/README.md\n  sections:\n    proposed: Proposed\n    accepted: Accepted\n    superseded: Superseded\nacceptedBaselinePath: architecture/decisions/accepted-decisions.json\n",
    );
    await put(
      "docs/decisions/README.md",
      "# Decisions\n\n## Proposed\n\n## Accepted\n\n## Superseded\n",
    );
    await put(
      "architecture/metadata-root.json",
      growthCanonicalJson({
        schemaVersion: "foundation:sdk-growth:metadata-root:1",
        kind: "non-release-metadata-root",
        packageName: "workspace-root",
        rootPath: ".",
        manifestPath: "package.json",
        decisionId: "ROOT-1",
        ownerRef: "synthetic/owner",
        releaseHistory: "none",
      }),
    );
    await put("architecture/sdk-growth/decisions.json", "[]\n");
    await put(
      "architecture/sdk-growth/evidence/trusted-base.json",
      growthCanonicalJson(fixture().grant.trustedBase),
    );
    const bootstrapHistory = {
      kind: "synthetic-bootstrap",
      packageName: "b-initial",
      releaseHistory: "initial-unreleased",
      ownerRef: "synthetic/owner",
      approved: true,
    };
    const bootstrapHistoryDigest = hashGrowthPayload(
      {
        domain: "synthetic-test:bootstrap-history:1",
        record: bootstrapHistory,
      },
      fingerprint,
    );
    await put(
      "architecture/sdk-growth/evidence/b-history.json",
      JSON.stringify({ historyDigest: bootstrapHistoryDigest }),
    );
    const configPath = "architecture/sdk-growth/profile.yaml";
    const config =
      "schemaVersion: 2\nacceptedDecisionBaselinePath: architecture/decisions/accepted-decisions.json\nchangesetDirectory: .changeset\ngovernanceConfigPath: architecture/foundation/governance.yaml\npackages:\n  - packageName: b-initial\n    packageRoot: packages/b-initial\n    manifestPath: packages/b-initial/package.json\n    entrypoints:\n      - exportPath: .\n        declarationEntryPoint: packages/b-initial/index.d.ts\n    nonTypeExports: []\n    tsconfigPath: packages/b-initial/tsconfig.json\n    releasedBaselinePath: architecture/public-api/b-initial.json\n    approvedBreakingChanges: []\nsdkGrowth:\n  contractRevision: foundation:sdk-growth:c0:5\n  policyVersion: foundation:sdk-growth:policy:1\n  comparison:\n    trustedBasePath: architecture/sdk-growth/evidence/trusted-base.json\n    released:\n      - packageName: b-initial\n        kind: initial-unreleased\n        trustedHistoryPath: architecture/sdk-growth/evidence/b-history.json\n  decisionsPath: architecture/sdk-growth/decisions.json\n  reportPath: sdk-growth-report.json\n";
    await put(configPath, config);
    git(["init", "--quiet"]);

    checkpoint("base");
    const baseSource = sourceIdentity();
    const packagePolicy = {
      packageName: "b-initial",
      packageRoot: "packages/b-initial",
      manifestPath: "packages/b-initial/package.json",
      tsconfigPath: "packages/b-initial/tsconfig.json",
      releasedBaselinePath: "architecture/public-api/b-initial.json",
      entrypoints: [
        {
          exportPath: ".",
          declarationEntryPoint: "packages/b-initial/index.d.ts",
        },
      ],
      nonTypeExports: [],
      approvedBreakingChanges: [],
    };
    const common = createPublicApiCompatibilityDependencies(
      async () => ({ acceptedDecisionIds: [], acceptedDecisionPaths: [] }),
      assertSchema,
    );
    const artifact = new FilesystemPackageArtifactInventory(
      new AjvJsonSchemaReleaseInspector({ read: readContainedRegularFile }),
      {
        files: { read: readContainedRegularFile },
        paths: { traversesSymbolicLink: pathTraversesSymbolicLink },
      },
    );
    async function observe() {
      const inventory = await createWorkspaceInventoryReader().read(
        root,
        "pnpm-workspace.yaml",
      );
      assert.deepEqual(
        inventory.packages.map((item) => item.name),
        ["workspace-root", "b-initial"],
      );
      assert.deepEqual(await readdir(join(root, "packages")), ["b-initial"]);
      const observed = await readGrowthInvocation(root, inventory, {
        files: { read: readContainedRegularFile },
        async runGit(args) {
          return {
            exitCode: 0,
            stdout: execFileSync("git", args, { encoding: "utf8" }),
          };
        },
      });
      const identity = { ...observed, repository: "github:123" };
      const growthInventory = await createWorkspaceGrowthReader(
        createWorkspaceInventoryReader(),
      ).read(root, "pnpm-workspace.yaml");
      const local = await createGrowthObservation(
        {
          consumerRoot: root,
          workspaceManifestPath: "pnpm-workspace.yaml",
          subjects: [{ policy: packagePolicy, packageVersion: "0.0.0" }],
        },
        {
          workspace: { read: async () => growthInventory },
          typed: common.extractor,
          artifact,
          fingerprint: common.fingerprint,
        },
      ).observe(identity, cancellation);
      return { identity, local };
    }
    const baseWitness = await typeOnlyWitness(packageRoot, undefined, [
      ["Marker", "number"],
    ]);
    assert.deepEqual(
      execFileSync("git", ["show", "HEAD:packages/b-initial/index.d.ts"], {
        cwd: root,
      }),
      baseWitness.declarationBytes,
    );
    const baseObserved = await observe();
    const base = completeTypeOnlyObservation(
      baseObserved.local,
      baseWitness,
      bootstrapHistory,
    );
    assert.equal(base.sourceCommit, baseSource.commit);
    for (const [name, path, bytes] of [
      [
        "unknown declaration edge",
        "packages/b-initial/index.d.ts",
        "export type Marker = number;\nimport type { X } from './other.js';\n",
      ],
      [
        "runtime export",
        "packages/b-initial/package.json",
        JSON.stringify({
          name: "b-initial",
          version: "0.0.0",
          exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
        }),
      ],
    ]) {
      await put(path, bytes);
      await assert.rejects(
        typeOnlyWitness(packageRoot, undefined, [["Marker", "number"]]),
      );

      checkpoint(`unsupported ${name}`);
      const unsupported = await observe();
      const surface =
        unsupported.local.surface.status === "available"
          ? {
              status: "available",
              value: normalizeGrowthObservation({
                ...unsupported.local.surface.value,
                coverage: unsupported.local.surface.value.coverage.filter(
                  (row) => row.packageName === "b-initial",
                ),
                entries: unsupported.local.surface.value.entries.filter(
                  (row) => row.coordinate.packageName === "b-initial",
                ),
              }),
            }
          : unsupported.local.surface;
      assert.equal(
        compareGrowthSurfaces(
          {
            trustedBefore: { status: "available", value: base },
            candidateAfter: surface,
          },
          fingerprint,
        ).status,
        "incomplete",
      );
      git(["reset", "--hard", baseSource.commit]);
    }
    // Candidate does not exist when the baseline observation is retained.
    await put(
      "packages/b-initial/index.d.ts",
      "export type Marker = number;\nexport type Added = string;\n",
    );

    checkpoint("candidate surface");
    execFileSync("tar", ["-czf", archivePath, "-C", packageRoot, "."]);
    const members = archiveMembers(archivePath);
    for (const kind of ["symlink", "hardlink"]) {
      const unsafeRoot = join(directory, kind);
      await mkdir(unsafeRoot);
      await writeFile(join(unsafeRoot, "target"), "ok");
      if (kind === "symlink") await symlink("target", join(unsafeRoot, "link"));
      else
        execFileSync("ln", [
          join(unsafeRoot, "target"),
          join(unsafeRoot, "link"),
        ]);
      const unsafeTar = join(directory, `${kind}.tgz`);
      execFileSync("tar", ["-czf", unsafeTar, "-C", unsafeRoot, "."]);
      assert.throws(
        () => archiveMembers(unsafeTar),
        /nonregular-archive-member/,
      );
    }
    const candidateWitness = await typeOnlyWitness(packageRoot, members, [
      ["Marker", "number"],
      ["Added", "string"],
    ]);
    const tarball = await readFile(archivePath);
    const tarballIdentity = {
      sha256: wireDigest(tarball),
      sri: fingerprint.sha512Integrity(tarball),
    };
    const preliminary = await observe();
    const preliminaryCandidate = completeTypeOnlyObservation(
      preliminary.local,
      candidateWitness,
    );
    const comparison = compareGrowthSurfaces(
      {
        trustedBefore: { status: "available", value: base },
        candidateAfter: { status: "available", value: preliminaryCandidate },
      },
      fingerprint,
    );
    assert.equal(comparison.status, "complete");
    assert.equal(comparison.transitions.length, 1);
    assert.equal(
      comparison.transitions[0].coordinate.subject.canonicalReference,
      "b-initial!Added:type",
    );
    const transition = comparison.transitions[0];
    const decision = {
      contractRevision: "foundation:sdk-growth:c0:5",
      decisionId: "ADD-1",
      ownerRef: "synthetic/owner",
      stability: "development",
      transitions: [transition.fingerprint],
      coordinates: [transition.coordinate],
      changeFingerprint: growthGroupFingerprint(
        [transition.fingerprint],
        fingerprint,
      ),
      consumerEvidenceRefs: [
        {
          useCase: "synthetic type-only fixture",
          repository: "github:123",
          source: {
            tree: baseSource.tree,
            contentDigest: wireDigest(baseWitness.declarationBytes),
            commit: baseSource.commit,
          },
          artifactDigest: null,
        },
      ],
      exposureRationale: "Synthetic owner approves Added",
      compatibilityRationale: "Additive type alias",
      lifecycle: { kind: "ordinary" },
    };
    await put(
      "architecture/sdk-growth/decisions.json",
      JSON.stringify([decision]),
    );

    checkpoint("candidate");
    const candidateSource = sourceIdentity();
    assert.deepEqual(
      execFileSync("git", ["show", "HEAD:packages/b-initial/index.d.ts"], {
        cwd: root,
      }),
      candidateWitness.declarationBytes,
    );
    const finalObserved = await observe();
    const candidate = completeTypeOnlyObservation(
      finalObserved.local,
      candidateWitness,
    );
    assert.equal(candidate.sourceCommit, candidateSource.commit);
    const finalComparison = compareGrowthSurfaces(
      {
        trustedBefore: { status: "available", value: base },
        candidateAfter: { status: "available", value: candidate },
      },
      fingerprint,
    );
    assert.deepEqual(finalComparison.transitions, [transition]);
    assert.deepEqual(
      (
        await typeOnlyWitness(packageRoot, members, [
          ["Marker", "number"],
          ["Added", "string"],
        ])
      ).declarationCensus,
      candidateWitness.declarationCensus,
    );
    await mkdir(install, { recursive: true });
    for (const [path, bytes] of members)
      await writeFile(join(install, path), bytes);
    const value = fixture();
    value.grant.archives = [];
    value.grant.released = value.grant.released.filter(
      (row) => row.packageName === "b-initial",
    );
    value.grant.candidates = value.grant.candidates.filter(
      (row) => row.packageName === "b-initial",
    );
    value.request.contextSelectors = {
      trustedBasePath: "architecture/sdk-growth/evidence/trusted-base.json",
      decisionsPath: "architecture/sdk-growth/decisions.json",
      released: [
        {
          packageName: "b-initial",
          kind: "initial-unreleased",
          trustedHistoryPath: "architecture/sdk-growth/evidence/b-history.json",
        },
      ],
    };
    const binding = value.request.binding;
    binding.historyDigest = bootstrapHistoryDigest;
    value.root.evidence.historyDigest = bootstrapHistoryDigest;
    value.grant.released[0].evidence.historyDigest = bootstrapHistoryDigest;
    value.grant.retainedHistory.receiptDigest = bootstrapHistoryDigest;
    binding.invocation = finalObserved.identity;
    binding.target.head = candidateSource;
    binding.target.base = baseSource;
    binding.target.mergeBase = baseSource;
    binding.target.evaluation = candidateSource;
    binding.tool.version = finalObserved.identity.tool.version;
    Object.assign(binding.tool, pinnedTool);
    assert.deepEqual(
      {
        archiveDigest: binding.tool.archiveDigest,
        archiveIntegrity: binding.tool.archiveIntegrity,
      },
      pinnedTool,
    );
    binding.tool.distributionDigest =
      finalObserved.identity.tool.artifactDigest;
    binding.tool.extractorVersion =
      finalObserved.identity.tool.extractorVersion;
    binding.policy.configurationDigest = wireDigest(Buffer.from(config));
    binding.policy.scopeDigest = hashGrowthPayload(
      {
        domain: "reviewrouter:sdk-growth-authority:scope:1",
        packages: [packagePolicy],
      },
      fingerprint,
    );
    binding.policy.commandDigest = hashGrowthPayload(
      {
        domain: "reviewrouter:sdk-growth-authority:command:1",
        entrypoint: "@agent-teams/engineering-foundation/sdk-growth-authority",
        operations: ["check", "promote-release"],
      },
      fingerprint,
    );
    const rootBytes = async (source) => ({
      source,
      manifestBytes: await readFile(join(root, "package.json"), "utf8"),
      workspaceBytes: await readFile(join(root, "pnpm-workspace.yaml"), "utf8"),
      classificationBytes: await readFile(
        join(root, "architecture/metadata-root.json"),
        "utf8",
      ),
    });
    value.root.evidence.base = await rootBytes(baseSource);
    value.root.evidence.candidate = await rootBytes(candidateSource);
    const packedCandidate = value.grant.candidates[0];
    const memberCustody = custody(Object.fromEntries(members));
    Object.assign(packedCandidate, {
      source: candidateSource,
      observation: candidate,
      coverage: candidate.coverage[0],
      observationDigest: growthObservationReference(candidate, fingerprint)
        .surfaceDigest,
      archiveDigest: memberCustody.archiveDigest,
      archiveIntegrity: memberCustody.archiveIntegrity,
      custodyEvidence: memberCustody,
      custodyEvidenceDigest: hashGrowthPayload(
        { domain: "foundation:sdk-growth:custody:1", payload: memberCustody },
        fingerprint,
      ),
    });
    packedCandidate.installedDistribution = {
      packageName: "b-initial",
      packageVersion: "0.0.0",
      source: candidateSource,
      archiveDigest: packedCandidate.archiveDigest,
      archiveIntegrity: packedCandidate.archiveIntegrity,
      observationDigest: packedCandidate.observationDigest,
    };
    assert.notEqual(tarballIdentity.sha256, packedCandidate.archiveDigest);
    value.grant.trustedBase = base;
    const baseRoot = metadataRootObservation(
      value.root,
      "base",
      base,
      fingerprint,
    );
    value.grant.trustedBase = normalizeGrowthObservation({
      ...base,
      coverage: [...base.coverage, ...baseRoot.coverage],
      entries: [...base.entries, ...baseRoot.entries],
    });
    value.grant.trustedBaseReference = growthObservationReference(
      value.grant.trustedBase,
      fingerprint,
    );
    value.grant.retainedHistory.targetSource = baseSource;
    value.grant.retainedHistory.targetSurfaceDigest =
      value.grant.trustedBaseReference.surfaceDigest;
    value.grant.retainedHistory.custodyEvidence = custody({
      "trusted-base.json": growthCanonicalJson(value.grant.trustedBase),
    });
    value.grant.retainedHistory.custodyEvidenceDigest = hashGrowthPayload(
      {
        domain: "foundation:sdk-growth:custody:1",
        payload: value.grant.retainedHistory.custodyEvidence,
      },
      fingerprint,
    );
    const candidateRoot = metadataRootObservation(
      value.root,
      "candidate",
      finalObserved.identity,
      fingerprint,
    );
    const baseCoverage = new Map(
      value.grant.trustedBase.coverage.map((row) => [row.packageName, row]),
    );
    const expectedCoverage = [...candidate.coverage, ...candidateRoot.coverage]
      .toSorted((a, b) =>
        a.packageName < b.packageName
          ? -1
          : a.packageName > b.packageName
            ? 1
            : 0,
      )
      .map((row) => ({
        ...row,
        dimensions: row.dimensions.map((dimension) => {
          if (dimension.dimension === "decision")
            return {
              ...dimension,
              status: "complete",
              reasons: ["growth-decision-set-evaluated"],
            };
          const before = baseCoverage
            .get(row.packageName)
            ?.dimensions.find((item) => item.dimension === dimension.dimension);
          return before === undefined
            ? dimension
            : {
                ...dimension,
                status: "complete",
                reasons: [
                  ...before.reasons.map((reason) => `trusted-base:${reason}`),
                  ...dimension.reasons.map((reason) => `candidate:${reason}`),
                ].toSorted(),
              };
        }),
      }));
    value.grant.requiredCoverageDigest = hashGrowthPayload(
      {
        domain: "reviewrouter:sdk-growth-authority:coverage:3",
        coverage: expectedCoverage,
      },
      fingerprint,
    );
    const decisionDigest = growthDecisionDigest(decision, fingerprint);
    value.request.decisionDigests = [decisionDigest];
    value.seal();
    const approval = {
      owner: "synthetic-owner",
      repository: "github:123",
      decisionDigest,
      transition: transition.fingerprint,
      source: candidateSource,
      approved: true,
    };
    value.grant.ownerEvidence = [
      {
        decisionId: decision.decisionId,
        ownerRef: decision.ownerRef,
        decisionDigest,
        authenticatedSubjectId: approval.owner,
        authorizationEvidenceDigest: hashGrowthPayload(
          { domain: "synthetic-test:authorization:1", approval },
          fingerprint,
        ),
        approvalEvidenceDigest: hashGrowthPayload(
          { domain: "synthetic-test:approval:1", approval },
          fingerprint,
        ),
        sourceBindingDigest: value.grant.requestDigest,
      },
    ];
    const installations = new Map([
      [
        growthCanonicalJson({
          packageName: "b-initial",
          packageVersion: "0.0.0",
          archiveDigest: packedCandidate.archiveDigest,
          archiveIntegrity: packedCandidate.archiveIntegrity,
          source: candidateSource,
        }),
        install,
      ],
    ]);
    const receipts = new Map();
    const committedByGrant = new Map();
    let firstCompletion = null;
    let receiptTamper = null;
    let completions = 0;
    const host = {
      async resolve({ request }) {
        validateHostRequest(request);
        assert.deepEqual(request.binding, binding);
        const bytes = wire(value.grant);
        return { wire: bytes, wireDigest: wireDigest(bytes) };
      },
      async complete({ completion }) {
        validateHostCompletion(completion);
        const digest = growthAuthorityCompletionDigest(completion, fingerprint);
        const prior = committedByGrant.get(completion.grantId);
        if (prior !== undefined && prior !== digest)
          throw new Error("synthetic-conflicting-completion");
        const reportBytes = await readFile(
          join(root, "sdk-growth-report.json"),
        );
        assert.equal(completion.reportByteLength, reportBytes.byteLength);
        assert.equal(completion.reportDigest, wireDigest(reportBytes));
        const report = JSON.parse(reportBytes);
        assert.equal(report.verdict, completion.verdict);
        assert.equal(report.releaseEligible, completion.releaseEligible);
        assert.deepEqual(completion.binding, binding);
        assert.equal(completion.requestDigest, value.grant.requestDigest);
        assert.equal(
          completion.grantDigest,
          growthAuthorityGrantDigest(value.grant, fingerprint),
        );
        assert.equal(
          completion.coverageDigest,
          value.grant.requiredCoverageDigest,
        );
        assert.equal(
          completion.phasesDigest,
          hashGrowthPayload(
            {
              domain: "reviewrouter:sdk-growth-authority:phases:3",
              phases: report.phases,
            },
            fingerprint,
          ),
        );
        assert.deepEqual(completion.promotion, { kind: "none" });
        completions++;
        firstCompletion ??= globalThis.structuredClone(completion);
        let receipt = receipts.get(digest);
        if (!receipt) {
          receipt = {
            schemaVersion: completion.schemaVersion,
            kind: "receipt",
            receiptId: "synthetic-receipt",
            grantId: completion.grantId,
            grantDigest: completion.grantDigest,
            requestDigest: completion.requestDigest,
            completionDigest: digest,
            binding: completion.binding,
            reportDigest: completion.reportDigest,
            coverageDigest: completion.coverageDigest,
            phasesDigest: completion.phasesDigest,
            verdict: completion.verdict,
            releaseEligible: completion.releaseEligible,
            qualification:
              completion.verdict === "admitted" && completion.releaseEligible
                ? "qualified"
                : "not-qualified",
            operation: "check",
            promotion: { kind: "none" },
            custodyRef: "synthetic-memory/receipt",
            issuedAt: now().toISOString(),
          };
          receipts.set(digest, receipt);
          committedByGrant.set(completion.grantId, digest);
        }
        const bytes = wire(receiptTamper ? receiptTamper(receipt) : receipt);
        return { wire: bytes, wireDigest: wireDigest(bytes) };
      },
      async readInstalled({ identity }) {
        const selected = installations.get(growthCanonicalJson(identity));
        if (!selected) throw new Error("unknown-installed-archive-identity");
        const rows = [];
        const pending = [""];
        const seen = new Set();
        while (pending.length) {
          const relative = pending.pop();
          for (const name of await readdir(join(selected, relative))) {
            const path = relative ? `${relative}/${name}` : name;
            if (path.includes("..") || path.startsWith("/"))
              throw new Error("unsafe-installed-member");
            const folded = path.toLowerCase();
            if (seen.has(folded)) throw new Error("duplicate-installed-member");
            seen.add(folded);
            const absolute = join(selected, path);
            const stat = await lstat(absolute);
            if (stat.isSymbolicLink())
              throw new Error("nonregular-installed-member");
            if (stat.isDirectory()) {
              pending.push(path);
              continue;
            }
            if (!stat.isFile() || stat.nlink !== 1)
              throw new Error("nonregular-installed-member");
            rows.push({
              path,
              bytes: await readContainedRegularFile({
                root: selected,
                candidate: absolute,
                maxBytes: 1024 * 1024,
              }),
            });
          }
        }
        return rows;
      },
    };
    const verifier = publicApi.createSdkGrowthAuthorityVerifier(
      createEfV3HostTransport(host),
      createEfV3InstalledInventoryReader(host),
      now,
    );
    const input = { consumerRoot: root, configPath, binding };
    const result = await verifier.qualifyCheck(input);
    assert.equal(result.report.verdict, "admitted");
    assert.equal(result.report.releaseEligible, true);
    assert.deepEqual(result.report.coverage, expectedCoverage);
    for (const row of result.report.coverage) {
      assert.deepEqual(
        row.dimensions.map((item) => item.dimension),
        [
          "bin",
          "data",
          "decision",
          "packed",
          "reachable",
          "resolution",
          "runtime",
          "topology",
          "typed",
          "wildcard",
        ],
      );
      assert.ok(row.dimensions.every((item) => item.status === "complete"));
    }
    assert.deepEqual(
      result.report.phases.map(({ name, status }) => ({ name, status })),
      [
        { name: "topology", status: "complete" },
        { name: "observation", status: "complete" },
        { name: "packed", status: "complete" },
        { name: "decision", status: "complete" },
        { name: "trusted-base", status: "complete" },
        { name: "released", status: "complete" },
        { name: "authority", status: "complete" },
      ],
    );
    assert.deepEqual(result.report.transitionReceipts[0].transitions, [
      transition.fingerprint,
    ]);
    assert.equal(result.receipt.qualification, "qualified");
    assert.equal(result.receipt.operation, "check");
    assert.deepEqual(result.receipt.promotion, { kind: "none" });
    assert.equal(completions, 1);
    assert.equal(
      result.reportDigest,
      wireDigest(await readFile(join(root, "sdk-growth-report.json"))),
    );
    assert.ok(tarballIdentity.sri.startsWith("sha512-"));
    const original = await readFile(join(install, "package.json"));
    for (const mutation of [
      async () => rm(join(install, "package.json")),
      async () => writeFile(join(install, "package.json"), "changed"),
      async () => writeFile(join(install, "extra.txt"), "extra"),
    ]) {
      await mutation();
      await assert.rejects(
        verifier.qualifyCheck(input),
        /growth-authority-installed-inventory-mismatch/,
      );
      await writeFile(join(install, "package.json"), original);
      await rm(join(install, "extra.txt"), { force: true });
    }
    await symlink("package.json", join(install, "link"));
    await assert.rejects(
      verifier.qualifyCheck(input),
      /nonregular-installed-member/,
    );
    await rm(join(install, "link"));
    execFileSync("ln", [
      join(install, "package.json"),
      join(install, "hardlink"),
    ]);
    await assert.rejects(
      verifier.qualifyCheck(input),
      /nonregular-installed-member/,
    );
    await rm(join(install, "hardlink"));
    await writeFile(join(install, "PACKAGE.JSON"), original);
    await assert.rejects(
      verifier.qualifyCheck(input),
      /duplicate-installed-member/,
    );
    await rm(join(install, "PACKAGE.JSON"));
    value.grant.released[0].evidence.historyDigest = d("9");
    await assert.rejects(
      verifier.qualifyCheck(input),
      /growth-authority-initial-history-mismatch/,
    );
    value.grant.released[0].evidence.historyDigest = bootstrapHistoryDigest;
    value.grant.retainedHistory.targetSource = candidateSource;
    await assert.rejects(
      verifier.qualifyCheck(input),
      /growth-authority-history-source-mismatch/,
    );
    value.grant.retainedHistory.targetSource = baseSource;
    const validArchivePayload = packedCandidate.custodyEvidence.archivePayload;
    packedCandidate.custodyEvidence.archivePayload += " ";
    await assert.rejects(verifier.qualifyCheck(input), /growth-authority-/);
    packedCandidate.custodyEvidence.archivePayload = validArchivePayload;
    value.grant.ownerEvidence[0].sourceBindingDigest = d("9");
    await assert.rejects(
      verifier.qualifyCheck(input),
      /growth-authority-owner-source-mismatch/,
    );
    value.grant.ownerEvidence[0].sourceBindingDigest =
      value.grant.requestDigest;
    value.root.ownerEvidence.sourceBindingDigest = d("9");
    await assert.rejects(
      verifier.qualifyCheck(input),
      /growth-metadata-root-owner-evidence-mismatch/,
    );
    value.root.ownerEvidence.sourceBindingDigest = value.grant.requestDigest;
    receiptTamper = (receipt) => ({
      ...receipt,
      binding: { ...receipt.binding, historyDigest: d("9") },
    });
    await assert.rejects(
      verifier.qualifyCheck(input),
      /growth-authority-receipt-binding-mismatch/,
    );
    receiptTamper = null;
    assert.equal(completions, 2);
    const retry = await host.complete({ completion: firstCompletion });
    assert.deepEqual(
      JSON.parse(Buffer.from(retry.wire).toString()),
      result.receipt,
    );
    await assert.rejects(
      host.complete({
        completion: {
          ...firstCompletion,
          reportDigest: d("9"),
        },
      }),
      /synthetic-conflicting-completion/,
    );
    assert.equal(completions, 3);
    const cancelled = new globalThis.AbortController();
    cancelled.abort(new Error("synthetic-cancelled"));
    await assert.rejects(
      verifier.qualifyCheck({ ...input, signal: cancelled.signal }),
      /Foundation check was cancelled/,
    );
    assert.equal(completions, 3);

    const approvedOwner = globalThis.structuredClone(value.grant.ownerEvidence);
    const approvedCoverageDigest = value.grant.requiredCoverageDigest;
    const coverageDigest = (rows) =>
      hashGrowthPayload(
        {
          domain: "reviewrouter:sdk-growth-authority:coverage:3",
          coverage: rows,
        },
        fingerprint,
      );
    const assertUnqualified = (negative, verdict, code) => {
      assert.equal(negative.report.verdict, verdict);
      assert.equal(negative.report.releaseEligible, false);
      assert.equal(negative.receipt.qualification, "not-qualified");
      assert.ok(
        negative.capability.diagnostics.some((row) =>
          row.ruleId.endsWith(`.${code}`),
        ),
        `missing public diagnostic ${code}`,
      );
    };

    // Remove only the decision's owner row; the metadata-root owner remains.
    value.grant.grantId = "synthetic-no-decision-owner";
    value.grant.ownerEvidence = [];
    value.grant.requiredCoverageDigest = coverageDigest(
      expectedCoverage.map((row) => ({
        ...row,
        dimensions: row.dimensions.map((dimension) =>
          dimension.dimension === "decision"
            ? {
                ...dimension,
                status: "unavailable",
                reasons: ["growth-owner-and-run-authority-unverified"],
              }
            : dimension,
        ),
      })),
    );
    assertUnqualified(
      await verifier.qualifyCheck(input),
      "incomplete",
      "growth-owner-evidence-unavailable",
    );

    // Each dishonest packed observation has its own grant and independently
    // recomputed observation and grant digests. The public check must reject
    // before the host can accept any completion or issue another receipt.
    const completeObservation = packedCandidate.observation;
    const setPackedObservation = (next, grantId) => {
      packedCandidate.observation = normalizeGrowthObservation(next);
      packedCandidate.coverage = packedCandidate.observation.coverage[0];
      packedCandidate.observationDigest = growthObservationReference(
        packedCandidate.observation,
        fingerprint,
      ).surfaceDigest;
      packedCandidate.installedDistribution.observationDigest =
        packedCandidate.observationDigest;
      value.grant.grantId = grantId;
      value.grant.ownerEvidence = globalThis.structuredClone(approvedOwner);
      value.grant.requiredCoverageDigest = approvedCoverageDigest;
      value.seal();
      value.grant.ownerEvidence[0].sourceBindingDigest =
        value.grant.requestDigest;
    };
    const presentMarker = completeObservation.entries.find(
      (entry) =>
        entry.coordinate.subject.kind === "typed" &&
        entry.coordinate.subject.canonicalReference ===
          "b-initial!Marker:type" &&
        entry.value.state === "present",
    );
    assert.ok(presentMarker);
    setPackedObservation(
      {
        ...completeObservation,
        entries: completeObservation.entries.map((entry) =>
          entry === presentMarker
            ? { ...entry, value: { ...entry.value, digest: d("9") } }
            : entry,
        ),
      },
      "synthetic-conflicting-overlap",
    );
    assert.notEqual(
      packedCandidate.observationDigest,
      growthObservationReference(completeObservation, fingerprint)
        .surfaceDigest,
    );
    let priorCompletions = completions;
    let priorReceipts = receipts.size;
    await assert.rejects(
      verifier.qualifyCheck({ ...input }),
      /growth-authority-overlapping-observation-mismatch/,
    );
    assert.equal(completions, priorCompletions);
    assert.equal(receipts.size, priorReceipts);

    setPackedObservation(
      {
        ...completeObservation,
        entries: completeObservation.entries.filter(
          (entry) => entry !== presentMarker,
        ),
      },
      "synthetic-missing-packed-entry",
    );
    assert.ok(
      packedCandidate.coverage.dimensions.some(
        (row) => row.dimension === "packed" && row.status === "complete",
      ),
    );
    priorCompletions = completions;
    priorReceipts = receipts.size;
    await assert.rejects(
      verifier.qualifyCheck({ ...input }),
      /growth-authority-packed-absence-mismatch/,
    );
    assert.equal(completions, priorCompletions);
    assert.equal(receipts.size, priorReceipts);

    // A freshly sealed packed observation with unavailable typed evidence must
    // stay incomplete even though the approval and installed bytes still exist.
    value.grant.ownerEvidence = approvedOwner;
    value.grant.grantId = "synthetic-observation-drift";
    const incompleteObservation = normalizeGrowthObservation({
      ...completeObservation,
      coverage: completeObservation.coverage.map((row) => ({
        ...row,
        dimensions: row.dimensions.map((dimension) =>
          dimension.dimension === "typed"
            ? {
                ...dimension,
                status: "unavailable",
                reasons: ["synthetic-packed-observation-drift"],
              }
            : dimension,
        ),
      })),
    });
    packedCandidate.observation = incompleteObservation;
    packedCandidate.coverage = incompleteObservation.coverage[0];
    packedCandidate.observationDigest = growthObservationReference(
      incompleteObservation,
      fingerprint,
    ).surfaceDigest;
    packedCandidate.installedDistribution.observationDigest =
      packedCandidate.observationDigest;
    value.grant.requiredCoverageDigest = coverageDigest(
      expectedCoverage.map((row) => ({
        ...row,
        dimensions: row.dimensions.map((dimension) => {
          if (dimension.dimension === "decision")
            return {
              ...dimension,
              status: "unavailable",
              reasons: ["growth-owner-and-run-authority-unverified"],
            };
          if (
            row.packageName !== "b-initial" ||
            dimension.dimension !== "typed"
          )
            return dimension;
          return {
            ...dimension,
            status: "unavailable",
            reasons: [
              ...baseCoverage
                .get("b-initial")
                .dimensions.find((item) => item.dimension === "typed")
                .reasons.map((reason) => `trusted-base:${reason}`),
              "candidate:synthetic-packed-observation-drift",
            ].toSorted(),
          };
        }),
      })),
    );
    value.seal();
    value.grant.ownerEvidence[0].sourceBindingDigest =
      value.grant.requestDigest;
    assertUnqualified(
      await verifier.qualifyCheck(input),
      "incomplete",
      "growth-comparison-incomplete",
    );

    // Commit the missing decision in this disposable repository so the public
    // invocation sees a clean, new source checkpoint rather than dirty files.
    await put("architecture/sdk-growth/decisions.json", "[]\n");
    checkpoint("candidate without decision");
    const noDecisionSource = sourceIdentity();
    const noDecisionObserved = await observe();
    const noDecisionCandidate = completeTypeOnlyObservation(
      noDecisionObserved.local,
      candidateWitness,
    );
    binding.invocation = noDecisionObserved.identity;
    binding.target.head = noDecisionSource;
    binding.target.evaluation = noDecisionSource;
    binding.tool.distributionDigest =
      noDecisionObserved.identity.tool.artifactDigest;
    value.root.evidence.candidate = await rootBytes(noDecisionSource);
    packedCandidate.source = noDecisionSource;
    packedCandidate.observation = noDecisionCandidate;
    packedCandidate.coverage = noDecisionCandidate.coverage[0];
    packedCandidate.observationDigest = growthObservationReference(
      noDecisionCandidate,
      fingerprint,
    ).surfaceDigest;
    packedCandidate.installedDistribution.source = noDecisionSource;
    packedCandidate.installedDistribution.observationDigest =
      packedCandidate.observationDigest;
    installations.clear();
    installations.set(
      growthCanonicalJson({
        packageName: "b-initial",
        packageVersion: "0.0.0",
        archiveDigest: packedCandidate.archiveDigest,
        archiveIntegrity: packedCandidate.archiveIntegrity,
        source: noDecisionSource,
      }),
      install,
    );
    value.request.decisionDigests = [];
    value.grant.grantId = "synthetic-no-decision";
    value.grant.ownerEvidence = [];
    value.grant.requiredCoverageDigest = approvedCoverageDigest;
    value.seal();
    assertUnqualified(
      await verifier.qualifyCheck(input),
      "rejected",
      "growth-transition-unadmitted",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
