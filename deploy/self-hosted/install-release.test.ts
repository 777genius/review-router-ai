import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  generateSelfHostedRelease,
  parseSelfHostedProducerAttestation,
  type SelfHostedReleaseInput,
} from "./install-release.ts";
import type { ReviewModelDispatchProfile } from "../../packages/shared/src/review-model-dispatch-contract.ts";

const execute = promisify(execFile);
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const generatedPath = "packages/protocol-review-action-v2/src/generated";
const actionGeneratedPath = "src/control-plane/generated/review-action-v2";
const actionBranch = "self-hosted-install-fixture";
const dispatchProfile: ReviewModelDispatchProfile = {
  extensionId: "review-model-dispatch.v2",
  descriptorDigest:
    "sha256:be55241ba86af0788b6a60973ac7c55e6aa33244d18bba52a230cbc195ba4a2d",
  policyVersion: "model-dispatch-policy.v2",
  transports: ["account_gateway", "runner_local_responses"],
  wireProtocols: ["openai-responses", "codex-responses"],
  defaultAgentProfileRefs: {
    account_gateway: "fixture-ocr",
    runner_local_responses: "fixture-ocr",
  },
  limits: {
    maxRequests: 32,
    maxConcurrentRequests: 1,
    maxRequestBytes: 16 * 1024 * 1024,
    maxResponseBytes: 8 * 1024 * 1024,
    maxOutputTokens: 32_768,
  },
};

test("real committed verifier outputs become separate, complete runtime and registration projections", async (t) => {
  const f = await releaseFixture(t);
  const release = await generateSelfHostedRelease(f.input);
  const candidate = release.bundle.candidate;
  assert.equal(candidate.actionCommitSha, f.input.expectedActionSha);
  assert.equal(release.saasSourceCommit, f.sourceCommit);
  assert.equal(candidate.runtimeEntrypointDigest, sha(f.runtime));
  assert.equal(candidate.contextGatewayEntrypointDigest, sha(f.contextGateway));
  assert.deepEqual(candidate.modelDispatchProfile, dispatchProfile);
  for (const key of [
    "reviewerPlanProfile",
    "contextToolsProfile",
    "lifecycleVerificationProfile",
    "prDescriptionProfile",
  ] as const) {
    assert(candidate[key], `the fixture must include ${key}`);
    assert.deepEqual(release.runtimeAttestation[key], candidate[key]);
  }
  assert.equal(
    candidate.reviewInvestigationProfile.capability,
    "review_investigation_v1",
  );
  assert.equal(
    candidate.reviewInvestigationProfile.coverageProfileHash,
    release.runtimeAttestation.reviewInvestigationCoverageProfileHash,
  );
  for (const key of [
    "canonicalizerDigest",
    "saasSourceCommit",
    "supportedContextGatewayPolicyVersions",
    "protocolLimitsProfileId",
    "operationalSloProfileId",
    "reviewInvestigationCapability",
  ])
    assert.equal(
      Object.hasOwn(candidate, key),
      false,
      `${key} is not a registration candidate field`,
    );
  assert.match(
    release.runtimeAttestation.canonicalizerDigest,
    /^[a-f0-9]{64}$/u,
  );
  assert.equal(
    Object.hasOwn(release.runtimeAttestation, "reviewInvestigationProfile"),
    false,
  );
  assert.equal(release.bundle.limits.maxWorkSlots, 200);
  assert.equal(release.bundle.thresholds.v1DrainMs, 3_600_000);
  assert.deepEqual(release.bundle.ownerRefs, ["fixture-operator"]);
  assert.equal(
    release.environment.REVIEW_ROUTER_ACTION_REF,
    `777genius/review-router@${f.input.expectedActionSha}`,
  );
  assert.equal(
    release.environment.REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_VERSION,
    "v1.2.3",
  );
  assert.equal(
    release.environment.REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_SHA256,
    sha(f.seed),
  );
  assert(
    release.environment.REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_URL?.includes(
      `/${f.input.expectedActionSha}/`,
    ),
  );
  assert.deepEqual(
    JSON.parse(
      release.environment
        .REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON!,
    ),
    [release.runtimeAttestation],
  );
  assert.deepEqual(
    JSON.parse(await readFile(release.bundlePath, "utf8")),
    release.bundle,
  );
  assert.equal((await stat(release.bundlePath)).mode & 0o777, 0o600);
  assert.equal(
    Object.keys(release.environment).some(
      (key) =>
        key.includes("ENABLED") ||
        key.includes("SECRET") ||
        key.includes("VOTE_LANES"),
    ),
    false,
  );
});

test("a retry preserves bytes and rejects a changed operator policy instead of overwriting registration material", async (t) => {
  const f = await releaseFixture(t);
  const first = await generateSelfHostedRelease(f.input);
  const original = await readFile(first.bundlePath, "utf8");
  assert.deepEqual(await generateSelfHostedRelease(f.input), first);
  await assert.rejects(
    generateSelfHostedRelease({ ...f.input, ownerRef: "different-operator" }),
    /refuses_changed_artifact/u,
  );
  assert.equal(await readFile(first.bundlePath, "utf8"), original);
  const manifest = jsonRecord(await readFile(first.manifestPath, "utf8"));
  await writeFile(
    first.manifestPath,
    canonical({ ...manifest, runtimeEntrypointDigest: "0".repeat(64) }),
  );
  await assert.rejects(
    generateSelfHostedRelease(f.input),
    /refuses_changed_artifact/u,
  );
  assert.equal(await readFile(first.bundlePath, "utf8"), original);
});

test("wrong SHA, branch, detached HEAD and dirty artifacts never produce an operator bundle", async (t) => {
  const f = await releaseFixture(t);
  await assert.rejects(
    generateSelfHostedRelease({
      ...f.input,
      expectedActionSha: "0".repeat(40),
    }),
    /does not match --expected-head/u,
  );
  await assert.rejects(
    generateSelfHostedRelease({ ...f.input, actionBranch: "other-branch" }),
    /expected other-branch/u,
  );
  await git(f.input.actionRepo, [
    "switch",
    "--detach",
    f.input.expectedActionSha,
  ]);
  await assert.rejects(
    generateSelfHostedRelease(f.input),
    /must not use a detached HEAD/u,
  );
  await git(f.input.actionRepo, ["switch", actionBranch]);
  await writeFile(
    join(f.input.actionRepo, "dist/index.js"),
    "changed after commit\n",
  );
  await assert.rejects(
    generateSelfHostedRelease(f.input),
    /repository must be clean/u,
  );
  await assert.rejects(
    readFile(join(f.input.outputDir, "review-v2-release-bundle.json")),
    { code: "ENOENT" },
  );
});

test("committed contract corruption and a missing source commit fail the actual verifier", async (t) => {
  const f = await releaseFixture(t);
  const unrelated = join(f.root, "unrelated-source");
  await initializeRepository(unrelated, "main");
  await write(unrelated, "README.md", "unrelated source\n");
  await commit(unrelated, "test: unrelated source");
  await assert.rejects(
    generateSelfHostedRelease({ ...f.input, repoRoot: unrelated }),
    /source commit does not exist/u,
  );
  await write(
    f.input.actionRepo,
    `${actionGeneratedPath}/review-action-v2.schema.json`,
    "{}\n",
  );
  await commit(f.input.actionRepo, "test: corrupt bound contract");
  const changedSha = await git(f.input.actionRepo, ["rev-parse", "HEAD"]);
  await assert.rejects(
    generateSelfHostedRelease({
      ...f.input,
      expectedActionSha: changedSha,
      outputDir: join(f.root, "corrupt-output"),
    }),
    /committed generated file digest mismatch/u,
  );
  await assert.rejects(
    readFile(join(f.input.outputDir, "review-v2-release-bundle.json")),
    { code: "ENOENT" },
  );
});

test("an output symlink cannot replace an existing file", async (t) => {
  const f = await releaseFixture(t);
  await mkdir(f.input.outputDir, { mode: 0o700 });
  const outside = join(f.root, "preserve.json");
  await writeFile(outside, "preserve\n");
  await symlink(
    outside,
    join(f.input.outputDir, "review-v2-release-bundle.json"),
  );
  await assert.rejects(
    generateSelfHostedRelease(f.input),
    /unsafe_output_path/u,
  );
  assert.equal(await readFile(outside, "utf8"), "preserve\n");
});

test("readiness validates optional profiles while retaining the complete current capability shape", async () => {
  const base = attestationFixture();
  assert.equal(
    parseSelfHostedProducerAttestation(base).actionCommitSha,
    base.actionCommitSha,
  );
  const complete = {
    ...base,
    contextToolsProfile: {
      extensionId: "context-tools.v1",
      descriptorDigest: `sha256:${"a".repeat(64)}`,
    },
    reviewerPlanProfile: {
      planVersion: 1,
      descriptorDigest: `sha256:${"b".repeat(64)}`,
    },
    lifecycleVerificationProfile: {
      extensionId: "lifecycle-verification.v1",
      descriptorDigest: `sha256:${"c".repeat(64)}`,
    },
    modelDispatchProfile: dispatchProfile,
    prDescriptionProfile: {
      extensionId: "pr-description.v1",
      canonicalizerDigest: "d".repeat(64),
    },
  };
  assert.deepEqual(parseSelfHostedProducerAttestation(complete), complete);
  for (const invalid of [
    {
      ...complete,
      contextToolsProfile: {
        ...complete.contextToolsProfile,
        descriptorDigest: "unverified",
      },
    },
    {
      ...complete,
      reviewerPlanProfile: { ...complete.reviewerPlanProfile, planVersion: 2 },
    },
    { ...complete, lifecycleVerificationProfile: null },
    {
      ...complete,
      modelDispatchProfile: {
        ...dispatchProfile,
        limits: { ...dispatchProfile.limits, maxRequests: 129 },
      },
    },
    {
      ...complete,
      prDescriptionProfile: {
        extensionId: "unknown",
        canonicalizerDigest: "d".repeat(64),
      },
    },
    { ...complete, reviewInvestigationPolicyHash: null },
    { ...complete, unknownCapability: true },
    {
      ...complete,
      agentProfiles: [{ ...base.agentProfiles[0], cancellation: false }],
    },
  ])
    assert.throws(() => parseSelfHostedProducerAttestation(invalid));
});

async function releaseFixture(t: TestContext) {
  const temporaryRoot = join(sourceRoot, "tmp");
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(join(temporaryRoot, "self-hosted-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, "source");
  const actionRepo = join(root, "action");
  await initializeRepository(repoRoot, "main");
  await cp(join(sourceRoot, generatedPath), join(repoRoot, generatedPath), {
    recursive: true,
  });
  await commit(repoRoot, "test: canonical source");
  const sourceCommit = await git(repoRoot, ["rev-parse", "HEAD"]);
  await initializeRepository(actionRepo, actionBranch);
  await write(
    actionRepo,
    "dist/index.js",
    "/* previous synthetic test runtime */\n",
  );
  await commit(actionRepo, "test: initial Action base");
  const actionBase = await git(actionRepo, ["rev-parse", "HEAD"]);
  await execute(
    process.execPath,
    [
      join(sourceRoot, "scripts/export-public-review-action-v2-contract.mjs"),
      "--saas-repo",
      repoRoot,
      "--action-repo",
      actionRepo,
      "--target-branch",
      actionBranch,
      "--expected-head",
      actionBase,
      "--expected-saas-head",
      sourceCommit,
      "--write",
    ],
    { cwd: sourceRoot, maxBuffer: 8 * 1024 * 1024, timeout: 60_000 },
  );
  const runtime =
    "/* harmless committed synthetic test runtime, never executed */\n";
  const contextGateway =
    "/* harmless committed synthetic context gateway, never executed */\n";
  await write(actionRepo, "dist/index.js", runtime);
  await write(actionRepo, "dist/context-gateway.js", contextGateway);
  const golden = jsonRecord(
    await readFile(
      join(
        sourceRoot,
        "scripts/fixtures/review-action-v2-release/review-investigation-capability-v1.golden.json",
      ),
      "utf8",
    ),
  );
  await write(
    actionRepo,
    "dist/context-gateway.release.json",
    canonical({
      artifactKind: "reviewrouter-context-gateway",
      metadataVersion: 2,
      contextGatewayEntrypointPath: "dist/context-gateway.js",
      contextGatewayEntrypointDigest: sha(contextGateway),
      contextGatewayPolicyVersion: "context-gateway-v4",
      supportedContextGatewayPolicyVersions: [
        "context-gateway-v3",
        "context-gateway-v4",
      ],
      reviewInvestigationCapability: "review_investigation_v1",
      reviewInvestigationCoverageProfileHash: asRecord(golden.coverageProfile)
        .sha256,
      reviewInvestigationPolicyHash: asRecord(golden.policy).sha256,
    }),
  );
  await write(
    actionRepo,
    "src/control-plane/review-agent-profiles.json",
    JSON.stringify(attestationFixture().agentProfiles),
  );
  await write(
    actionRepo,
    "src/control-plane/review-model-dispatch-profile.json",
    JSON.stringify(dispatchProfile),
  );
  await write(
    actionRepo,
    "package.json",
    JSON.stringify({ version: "1.2.3", private: true }),
  );
  // The digest must cover original bytes, including non-UTF8 data in a shell comment.
  const seed = Buffer.concat([
    Buffer.from("#!/bin/sh\n# synthetic installer fixture "),
    Buffer.from([0xff, 0x0a]),
  ]);
  await write(actionRepo, "scripts/seed-codex-rotating-auth.sh", seed);
  await commit(actionRepo, "test: committed release artifacts");
  const input: SelfHostedReleaseInput = {
    repoRoot,
    actionRepo,
    expectedActionSha: await git(actionRepo, ["rev-parse", "HEAD"]),
    actionBranch,
    outputDir: join(root, "release"),
    ownerRef: "fixture-operator",
  };
  return { root, input, sourceCommit, runtime, contextGateway, seed };
}

function attestationFixture() {
  return {
    producerReleaseId: "synthetic-self-hosted-shape-fixture",
    distributionKind: "public_reusable",
    actionCommitSha: "a".repeat(40),
    runtimeCommitSha: "a".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "b".repeat(64),
    contextGatewayPolicyVersion: "context-gateway-v4",
    contextGatewayEntrypointDigest: "c".repeat(64),
    schemaDigest: "d".repeat(64),
    canonicalizerDigest: "e".repeat(64),
    capabilityProfile: "exact_revision_v2",
    protocolLimitsProfileId: "fixture-limits",
    operationalSloProfileId: "fixture-slo",
    reviewInvestigationCapability: "review_investigation_v1",
    reviewInvestigationCoverageProfileHash: "f".repeat(64),
    reviewInvestigationPolicyHash: "0".repeat(64),
    agentProfiles: [
      {
        profileRef: "fixture-ocr",
        agentKind: "ocr",
        binarySha256: "1".repeat(64),
        packageVersion: "1.13.1-rr.6",
        modelTransports: ["account_gateway", "provider_api"],
        contextGateway: false,
        cancellation: true,
        reviewSkillsVersion: 1,
      },
    ],
  };
}

async function initializeRepository(path: string, branch: string) {
  await mkdir(path, { recursive: true });
  await git(path, ["init", "-b", branch]);
  await git(path, ["config", "user.name", "iliya"]);
  await git(path, ["config", "user.email", "iliyazelenkog@gmail.com"]);
  await git(path, ["config", "commit.gpgSign", "false"]);
}

async function commit(path: string, message: string) {
  await git(path, ["add", "."]);
  await git(path, ["commit", "-m", message]);
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execute("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function write(root: string, path: string, data: string | Uint8Array) {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}

function sha(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonRecord(value: string) {
  return asRecord(JSON.parse(value));
}
function asRecord(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}
function canonical(value: unknown): string {
  return `${JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item), 2)}\n`;
}
