import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const ef = async (path) =>
  import(pathToFileURL(join(packageRoot, "dist", path)).href);
const publicApi = await import(
  pathToFileURL(join(packageRoot, "dist/sdk-growth-authority.js")).href
);
assert.equal(typeof publicApi.createSdkGrowthAuthorityVerifier, "function");
const { ReviewRouterGrowthAuthorityAcl } = await ef(
  "capabilities/public-api-compatibility/adapters/outbound/reviewrouter/reviewrouter-growth-authority-acl.js",
);
const { hashGrowthPayload } = await ef(
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
const { readContainedRegularFile } = await ef("source-inventory/node.js");

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
for (const [name, mutate] of [
  [
    "forged owner",
    (value) => {
      value.root.ownerEvidence.sourceBindingDigest = d("9");
    },
  ],
  [
    "malformed owner",
    (value) => {
      delete value.root.ownerEvidence.approvalEvidenceDigest;
    },
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
    await assert.rejects(
      harness(value).acl.resolve(value.request, cancellation),
      /growth-/,
    );
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
