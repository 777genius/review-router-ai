import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  parseReviewAgentProfiles,
  type ReviewAgentProfile,
} from "../../packages/shared/src/review-agent-profile.ts";
import {
  parseReviewModelDispatchProfile,
  type ReviewModelDispatchProfile,
} from "../../packages/shared/src/review-model-dispatch-contract.ts";
import { resolveCodexRotatingInstallerDescriptor } from "../../packages/shared/src/validation/codex-rotating-installer-descriptor.mjs";
import {
  trustedProducerReleaseMaterializationLimits,
  trustedProducerReleaseMaterializationRunbookRefs,
  trustedProducerReleaseMaterializationThresholds,
} from "../../packages/features/review-run-control/src/producer-release-defaults.ts";

const execute = promisify(execFile);
const implementationRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const seedPath = "scripts/seed-codex-rotating-auth.sh";
const attestationEnv =
  "REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON";
const optionalProfileKeys = [
  "reviewerPlanProfile",
  "contextToolsProfile",
  "lifecycleVerificationProfile",
  "modelDispatchProfile",
  "prDescriptionProfile",
] as const;
const attestationKeys = [
  "producerReleaseId",
  "distributionKind",
  "actionCommitSha",
  "runtimeCommitSha",
  "wrapperEntrypointDigest",
  "runtimeEntrypointDigest",
  "contextGatewayPolicyVersion",
  "contextGatewayEntrypointDigest",
  "schemaDigest",
  "canonicalizerDigest",
  "capabilityProfile",
  "protocolLimitsProfileId",
  "operationalSloProfileId",
  "reviewInvestigationCapability",
  "reviewInvestigationCoverageProfileHash",
  "reviewInvestigationPolicyHash",
  "agentProfiles",
] as const;

type OptionalProfiles = Readonly<{
  reviewerPlanProfile?: Readonly<{ planVersion: 1; descriptorDigest: string }>;
  contextToolsProfile?: Readonly<{
    extensionId: "context-tools.v1";
    descriptorDigest: string;
  }>;
  lifecycleVerificationProfile?: Readonly<{
    extensionId: "lifecycle-verification.v1";
    descriptorDigest: string;
  }>;
  modelDispatchProfile?: ReviewModelDispatchProfile;
  prDescriptionProfile?: Readonly<{
    extensionId: "pr-description.v1";
    canonicalizerDigest: string;
  }>;
}>;

/** Runtime JSON is deliberately distinct from the operator registration DTO. */
export type SelfHostedProducerAttestation = OptionalProfiles &
  Readonly<{
    producerReleaseId: string;
    distributionKind: "public_reusable" | "hosted_composite";
    actionCommitSha: string;
    runtimeCommitSha: string;
    wrapperEntrypointDigest: string | null;
    runtimeEntrypointDigest: string;
    contextGatewayPolicyVersion: string;
    contextGatewayEntrypointDigest: string;
    schemaDigest: string;
    canonicalizerDigest: string;
    capabilityProfile: "exact_revision_v2";
    protocolLimitsProfileId: string;
    operationalSloProfileId: string;
    reviewInvestigationCapability: "review_investigation_v1";
    reviewInvestigationCoverageProfileHash: string;
    reviewInvestigationPolicyHash: string;
    agentProfiles: readonly ReviewAgentProfile[];
  }>;

type RegistrationCandidate = Omit<
  SelfHostedProducerAttestation,
  | "canonicalizerDigest"
  | "protocolLimitsProfileId"
  | "operationalSloProfileId"
  | "reviewInvestigationCapability"
  | "reviewInvestigationCoverageProfileHash"
  | "reviewInvestigationPolicyHash"
> &
  Readonly<{
    reviewInvestigationProfile: Readonly<{
      capability: "review_investigation_v1";
      coverageProfileHash: string;
      policyHash: string;
    }>;
  }>;

export type SelfHostedReleaseBundle = Readonly<{
  protocolLimitsProfileId: string;
  limits: typeof trustedProducerReleaseMaterializationLimits;
  operationalSloProfileId: string;
  thresholds: typeof trustedProducerReleaseMaterializationThresholds;
  ownerRefs: readonly string[];
  runbookRefs: readonly string[];
  candidate: RegistrationCandidate;
}>;

export type SelfHostedReleaseInput = Readonly<{
  repoRoot: string;
  actionRepo: string;
  expectedActionSha: string;
  actionBranch: string;
  outputDir: string;
  ownerRef: string;
}>;

export type SelfHostedRelease = Readonly<{
  manifestPath: string;
  bundlePath: string;
  producerReleaseId: string;
  actionCommitSha: string;
  saasSourceCommit: string;
  runtimeAttestation: SelfHostedProducerAttestation;
  environment: Readonly<Record<string, string>>;
  bundle: SelfHostedReleaseBundle;
}>;

/** Verify committed artifacts before producing any configuration or registration bundle.
 * Requires Git, the existing release checker dependencies and the handoff's source
 * commit in repoRoot. This command never fetches, executes Action code or writes a DB.
 */
export async function generateSelfHostedRelease(
  input: SelfHostedReleaseInput,
): Promise<SelfHostedRelease> {
  const expectedActionSha = sha(
    input.expectedActionSha,
    40,
    "expectedActionSha",
  );
  const ownerRef = identifier(input.ownerRef, "ownerRef");
  if (
    !input.actionBranch ||
    input.actionBranch.startsWith("refs/") ||
    input.actionBranch.startsWith("-")
  )
    throw new Error("self_hosted_release_explicit_local_branch_required");
  const [repoRoot, actionRepo] = await Promise.all([
    realpath(input.repoRoot),
    realpath(input.actionRepo),
  ]);
  await mkdir(input.outputDir, { recursive: true, mode: 0o700 });
  await requireRegularPath(input.outputDir, true);
  const outputDir = await realpath(input.outputDir);
  const relativeOutput = relative(actionRepo, outputDir);
  if (
    relativeOutput === "" ||
    (!relativeOutput.startsWith("..") && !isAbsolute(relativeOutput))
  )
    throw new Error(
      "self_hosted_release_output_must_be_outside_action_checkout",
    );
  const manifestPath = join(
    outputDir,
    "review-action-v2-release-manifest.json",
  );
  const bundlePath = join(outputDir, "review-v2-release-bundle.json");
  await requireRegularPath(manifestPath);
  await requireRegularPath(bundlePath);

  const { verified, manifestBytes } = await verifyArtifacts({
    repoRoot,
    actionRepo,
    expectedActionSha,
    outputDir,
    actionBranch: input.actionBranch,
  });
  const row = record(verified, "verified release");
  exactKeys(
    row,
    [
      "saasSourceCommit",
      "distributionKind",
      "actionCommitSha",
      "runtimeCommitSha",
      "wrapperEntrypointDigest",
      "runtimeEntrypointDigest",
      "contextGatewayPolicyVersion",
      "contextGatewayEntrypointDigest",
      "schemaDigest",
      "canonicalizerDigest",
      "reviewInvestigationProfile",
      "agentProfiles",
      "supportedContextGatewayPolicyVersions",
    ],
    optionalProfileKeys,
  );
  if (
    row.actionCommitSha !== expectedActionSha ||
    row.runtimeCommitSha !== expectedActionSha ||
    row.distributionKind !== "public_reusable" ||
    row.wrapperEntrypointDigest !== null
  )
    throw new Error("self_hosted_release_verified_action_mismatch");
  const saasSourceCommit = sha(row.saasSourceCommit, 40, "saasSourceCommit");
  const investigation = record(
    row.reviewInvestigationProfile,
    "reviewInvestigationProfile",
  );
  exactKeys(investigation, ["capability", "coverageProfileHash", "policyHash"]);
  const protocolLimitsProfileId = `self-hosted-limits-${digest(canonicalJson(trustedProducerReleaseMaterializationLimits))}`;
  const slo = {
    thresholds: trustedProducerReleaseMaterializationThresholds,
    ownerRefs: [ownerRef],
    runbookRefs: trustedProducerReleaseMaterializationRunbookRefs,
  };
  const operationalSloProfileId = `self-hosted-slo-${digest(canonicalJson(slo))}`;
  const producerReleaseId = `self-hosted-action-${expectedActionSha}`;
  const {
    saasSourceCommit: _source,
    supportedContextGatewayPolicyVersions: _policies,
    reviewInvestigationProfile: _investigation,
    ...fields
  } = row;
  void _source;
  void _policies;
  void _investigation;
  const runtimeAttestation = parseSelfHostedProducerAttestation({
    ...fields,
    producerReleaseId,
    capabilityProfile: "exact_revision_v2",
    protocolLimitsProfileId,
    operationalSloProfileId,
    reviewInvestigationCapability: investigation.capability,
    reviewInvestigationCoverageProfileHash: investigation.coverageProfileHash,
    reviewInvestigationPolicyHash: investigation.policyHash,
  });
  const {
    canonicalizerDigest: _canonicalizer,
    protocolLimitsProfileId: _limits,
    operationalSloProfileId: _slo,
    reviewInvestigationCapability: capability,
    reviewInvestigationCoverageProfileHash: coverageProfileHash,
    reviewInvestigationPolicyHash: policyHash,
    ...candidateFields
  } = runtimeAttestation;
  void _canonicalizer;
  void _limits;
  void _slo;
  const bundle: SelfHostedReleaseBundle = {
    protocolLimitsProfileId,
    limits: trustedProducerReleaseMaterializationLimits,
    operationalSloProfileId,
    ...slo,
    candidate: {
      ...candidateFields,
      reviewInvestigationProfile: {
        capability,
        coverageProfileHash,
        policyHash,
      },
    },
  };
  const packageJson = record(
    JSON.parse(
      (
        await committedFile(actionRepo, expectedActionSha, "package.json")
      ).toString("utf8"),
    ),
    "Action package.json",
  );
  if (
    typeof packageJson.version !== "string" ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(packageJson.version)
  )
    throw new Error("self_hosted_release_action_package_version_invalid");
  const environment = {
    REVIEW_ROUTER_ACTION_REF: `777genius/review-router@${expectedActionSha}`,
    REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${expectedActionSha}`,
    REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_URL: `https://raw.githubusercontent.com/777genius/review-router/${expectedActionSha}/${seedPath}`,
    REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_VERSION: `v${packageJson.version}`,
    REVIEW_ROUTER_CODEX_ROTATING_INSTALLER_SHA256: digest(
      await committedFile(actionRepo, expectedActionSha, seedPath),
    ),
    [attestationEnv]: JSON.stringify([runtimeAttestation]),
  };
  resolveCodexRotatingInstallerDescriptor(environment);
  await writeImmutable(manifestPath, manifestBytes);
  await writeImmutable(bundlePath, canonicalJson(bundle));
  return {
    manifestPath,
    bundlePath,
    producerReleaseId,
    actionCommitSha: expectedActionSha,
    saasSourceCommit,
    runtimeAttestation,
    environment,
    bundle,
  };
}

/** The self-hosted preflight and installer share one current wire-shape check.
 * Artifact authenticity comes from the committed-release verifier above, never
 * from accepting these JSON fields or merely passing a health check.
 */
export function parseSelfHostedProducerAttestation(
  value: unknown,
): SelfHostedProducerAttestation {
  const row = record(value, "producer attestation");
  exactKeys(row, attestationKeys, optionalProfileKeys);
  if (
    row.distributionKind !== "public_reusable" &&
    row.distributionKind !== "hosted_composite"
  )
    throw new Error("self_hosted_release_distribution_invalid");
  if (
    row.capabilityProfile !== "exact_revision_v2" ||
    row.reviewInvestigationCapability !== "review_investigation_v1"
  )
    throw new Error("self_hosted_release_capability_invalid");
  const profiles: OptionalProfiles = {
    ...(Object.hasOwn(row, "reviewerPlanProfile")
      ? { reviewerPlanProfile: reviewerPlanProfile(row.reviewerPlanProfile) }
      : {}),
    ...(Object.hasOwn(row, "contextToolsProfile")
      ? {
          contextToolsProfile: descriptorProfile(
            row.contextToolsProfile,
            "context-tools.v1",
          ),
        }
      : {}),
    ...(Object.hasOwn(row, "lifecycleVerificationProfile")
      ? {
          lifecycleVerificationProfile: descriptorProfile(
            row.lifecycleVerificationProfile,
            "lifecycle-verification.v1",
          ),
        }
      : {}),
    ...(Object.hasOwn(row, "modelDispatchProfile")
      ? {
          modelDispatchProfile: parseReviewModelDispatchProfile(
            row.modelDispatchProfile,
          ),
        }
      : {}),
    ...(Object.hasOwn(row, "prDescriptionProfile")
      ? { prDescriptionProfile: prDescriptionProfile(row.prDescriptionProfile) }
      : {}),
  };
  return {
    ...profiles,
    producerReleaseId: identifier(row.producerReleaseId, "producerReleaseId"),
    distributionKind: row.distributionKind,
    actionCommitSha: sha(row.actionCommitSha, 40, "actionCommitSha"),
    runtimeCommitSha: sha(row.runtimeCommitSha, 40, "runtimeCommitSha"),
    wrapperEntrypointDigest:
      row.wrapperEntrypointDigest === null
        ? null
        : sha(row.wrapperEntrypointDigest, 64, "wrapperEntrypointDigest"),
    runtimeEntrypointDigest: sha(
      row.runtimeEntrypointDigest,
      64,
      "runtimeEntrypointDigest",
    ),
    contextGatewayPolicyVersion: identifier(
      row.contextGatewayPolicyVersion,
      "contextGatewayPolicyVersion",
    ),
    contextGatewayEntrypointDigest: sha(
      row.contextGatewayEntrypointDigest,
      64,
      "contextGatewayEntrypointDigest",
    ),
    schemaDigest: sha(row.schemaDigest, 64, "schemaDigest"),
    canonicalizerDigest: sha(
      row.canonicalizerDigest,
      64,
      "canonicalizerDigest",
    ),
    capabilityProfile: row.capabilityProfile,
    protocolLimitsProfileId: identifier(
      row.protocolLimitsProfileId,
      "protocolLimitsProfileId",
    ),
    operationalSloProfileId: identifier(
      row.operationalSloProfileId,
      "operationalSloProfileId",
    ),
    reviewInvestigationCapability: row.reviewInvestigationCapability,
    reviewInvestigationCoverageProfileHash: sha(
      row.reviewInvestigationCoverageProfileHash,
      64,
      "reviewInvestigationCoverageProfileHash",
    ),
    reviewInvestigationPolicyHash: sha(
      row.reviewInvestigationPolicyHash,
      64,
      "reviewInvestigationPolicyHash",
    ),
    agentProfiles: parseReviewAgentProfiles(row.agentProfiles),
  };
}

function descriptorProfile<const Extension extends string>(
  value: unknown,
  extensionId: Extension,
): Readonly<{ extensionId: Extension; descriptorDigest: string }> {
  const row = record(value, extensionId);
  exactKeys(row, ["extensionId", "descriptorDigest"]);
  if (
    row.extensionId !== extensionId ||
    typeof row.descriptorDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(row.descriptorDigest)
  )
    throw new Error("self_hosted_release_profile_invalid");
  return { extensionId, descriptorDigest: row.descriptorDigest };
}

function reviewerPlanProfile(
  value: unknown,
): NonNullable<OptionalProfiles["reviewerPlanProfile"]> {
  const row = record(value, "reviewerPlanProfile");
  exactKeys(row, ["planVersion", "descriptorDigest"]);
  if (
    row.planVersion !== 1 ||
    typeof row.descriptorDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(row.descriptorDigest)
  )
    throw new Error("self_hosted_release_reviewer_plan_invalid");
  return { planVersion: 1, descriptorDigest: row.descriptorDigest };
}

function prDescriptionProfile(
  value: unknown,
): NonNullable<OptionalProfiles["prDescriptionProfile"]> {
  const row = record(value, "prDescriptionProfile");
  exactKeys(row, ["extensionId", "canonicalizerDigest"]);
  if (row.extensionId !== "pr-description.v1")
    throw new Error("self_hosted_release_pr_description_invalid");
  return {
    extensionId: row.extensionId,
    canonicalizerDigest: sha(
      row.canonicalizerDigest,
      64,
      "prDescriptionProfile.canonicalizerDigest",
    ),
  };
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`self_hosted_release_object_invalid:${name}`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error("self_hosted_release_fields_invalid");
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 255 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw new Error(`self_hosted_release_identifier_invalid:${name}`);
  return value;
}

function sha(value: unknown, length: 40 | 64, name: string): string {
  if (
    typeof value !== "string" ||
    value.length !== length ||
    !/^[a-f0-9]+$/u.test(value)
  )
    throw new Error(`self_hosted_release_digest_invalid:${name}`);
  return value;
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, (_key, item: unknown) => (item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item), 2)}\n`;
}

async function runNode(
  script: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  return run(
    process.execPath,
    [join(implementationRoot, "scripts", script), ...args],
    cwd,
  );
}

async function verifyArtifacts(
  input: Omit<SelfHostedReleaseInput, "ownerRef">,
): Promise<{ verified: unknown; manifestBytes: string }> {
  // A terminated verifier can leave only owned staging data, never a partial
  // published manifest that would prevent the next installer run from resuming.
  const staging = await mkdtemp(join(input.outputDir, ".release-verify-"));
  const manifest = join(staging, "manifest.json");
  try {
    await runNode(
      "generate-public-review-action-v2-release-manifest.mjs",
      [
        "--action-repo",
        input.actionRepo,
        "--target-branch",
        input.actionBranch,
        "--expected-head",
        input.expectedActionSha,
        "--output",
        manifest,
      ],
      input.repoRoot,
    );
    const verified: unknown = JSON.parse(
      await runNode(
        "check-public-review-action-v2-release-manifest.mjs",
        [
          "--manifest",
          manifest,
          "--saas-repo",
          input.repoRoot,
          "--action-repo",
          input.actionRepo,
        ],
        input.repoRoot,
      ),
    );
    return { verified, manifestBytes: await readFile(manifest, "utf8") };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  try {
    const result = await execute(command, args, {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const detail =
      error &&
      typeof error === "object" &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr.trim().slice(0, 1500)
        : "command could not complete";
    throw new Error(`self_hosted_release_verification_failed: ${detail}`);
  }
}

async function committedFile(
  repo: string,
  commit: string,
  path: string,
): Promise<Buffer> {
  const tree = (await run("git", ["ls-tree", commit, "--", path], repo)).trim();
  if (
    !new RegExp(
      `^100(?:644|755) blob [a-f0-9]{40}\\t${path.replaceAll(".", "\\.")}$`,
      "u",
    ).test(tree)
  )
    throw new Error(
      `self_hosted_release_regular_committed_file_required:${path}`,
    );
  const result = await execute("git", ["show", `${commit}:${path}`], {
    cwd: repo,
    encoding: "buffer",
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout;
}

async function requireRegularPath(
  path: string,
  directory = false,
): Promise<void> {
  try {
    const status = await lstat(path);
    if (directory ? !status.isDirectory() : !status.isFile())
      throw new Error("self_hosted_release_unsafe_output_path");
  } catch (error) {
    if (
      !directory &&
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return;
    throw error;
  }
}

async function writeImmutable(path: string, contents: string): Promise<void> {
  const staging = await mkdtemp(join(dirname(path), ".release-write-"));
  const stagedPath = join(staging, "artifact.json");
  try {
    await writeFile(stagedPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    try {
      await link(stagedPath, path);
    } catch (error) {
      if (
        !(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "EEXIST"
        )
      )
        throw error;
      await requireRegularPath(path);
      if ((await readFile(path, "utf8")) !== contents)
        throw new Error("self_hosted_release_refuses_changed_artifact");
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
