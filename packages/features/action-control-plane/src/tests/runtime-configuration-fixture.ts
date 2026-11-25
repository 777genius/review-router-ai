import { createHash } from "node:crypto";
import { workspacePolicyFixture } from "../../../review-config/src/tests/current-policy-fixture";
import { canonicalJson } from "../../../review-config/src/domain/review-configuration";
import type { RuntimeReviewConfigurationRecord } from "../application/ports/action-control-plane-repository-port";

export const savedWorkspaceRuntimeFixture: RuntimeReviewConfigurationRecord = {
  source: "workspace",
  version: 1,
  workspaceVersion: 1,
  repositoryVersion: null,
  effectivePolicyDigest: `sha256:${createHash("sha256").update(canonicalJson(workspacePolicyFixture)).digest("hex")}`,
  config: workspacePolicyFixture,
};
