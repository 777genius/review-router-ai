import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseReviewV2ReleaseBundleCandidate } from "../../../apps/api/src/review-action-v2-operator-cli.js";
import {
  ReviewCapabilityProfile,
  type ProducerReleaseCandidate,
} from "../../../packages/features/review-run-control/src/index.js";
import { reviewActionV2CanonicalizerDigest } from "../../../packages/protocol-review-action-v2/src/index.js";
import { generateReleaseManifest } from "../../generate-public-review-action-v2-release-manifest.mjs";
import { checkReleaseManifest } from "../../check-public-review-action-v2-release-manifest.mjs";
import { DEFAULT_SOURCE_DIRECTORY } from "../../export-public-review-action-v2-contract.mjs";
import {
  assertRepositoryClean,
  currentCommit,
} from "../../lib/git-release-artifacts.mjs";
import { buildReleaseRegistrationCandidateFields } from "../../lib/review-action-v2-release-manifests.mjs";

/** Use the normal exact-commit release path, never fixture-injected policy. */
export function committedLifecycleProducerRelease(
  actionRepo: string,
): ProducerReleaseCandidate {
  assertRepositoryClean(actionRepo, "paired Action source");
  const expectedHead = currentCommit(actionRepo);
  const expectedPin = process.env.REVIEW_ROUTER_PAIRED_ACTION_REF;
  if (expectedPin !== undefined && expectedPin !== expectedHead)
    throw new Error("paired_committed_release_action_pin_mismatch");
  const temporary = mkdtempSync(path.join(tmpdir(), "paired-release-policy-"));
  try {
    // CI supplies a detached immutable checkout. Keep the normal release
    // generator's named-branch/clean-tree fence in an owned local clone.
    const releaseRepo = path.join(temporary, "action");
    execFileSync("git", [
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--no-checkout",
      actionRepo,
      releaseRepo,
    ]);
    execFileSync("git", [
      "-C",
      releaseRepo,
      "checkout",
      "--quiet",
      "-b",
      "paired-release",
      expectedHead,
    ]);
    const manifestPath = path.join(temporary, "release.json");
    const { manifest } = generateReleaseManifest({
      actionRepo: releaseRepo,
      targetBranch: "paired-release",
      expectedHead,
      output: manifestPath,
    });
    checkReleaseManifest({
      actionRepo: releaseRepo,
      saasRepo: fileURLToPath(new URL("../../../", import.meta.url)),
      sourceDirectory: DEFAULT_SOURCE_DIRECTORY,
      manifest: manifestPath,
    });
    // Canonicalizer identity belongs to attestation, not the operator's
    // ProducerReleaseCandidate DTO. Check it before projecting that boundary.
    const { canonicalizerDigest, ...fields } =
      buildReleaseRegistrationCandidateFields(manifest);
    if (canonicalizerDigest !== reviewActionV2CanonicalizerDigest)
      throw new Error("paired_committed_release_canonicalizer_mismatch");
    const prefix = `paired-committed-${randomUUID()}`;
    const candidate = parseReviewV2ReleaseBundleCandidate({
      ...fields,
      producerReleaseId: `${prefix}-release`,
      capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
    });
    if (!candidate.modelDispatchProfile)
      throw new Error("paired_committed_release_dispatch_profile_required");
    return {
      ...candidate,
      protocolLimitsProfileId: `${prefix}-limits`,
      operationalSloProfileId: `${prefix}-slo`,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
