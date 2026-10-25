import pg from "pg";
import { reviewActionV2SupportedContracts } from "../../../packages/protocol-review-action-v2/src/schema-slots.ts";
import { FIXTURES } from "./contracts.ts";

export const SKILLS_READINESS_REPOSITORIES = {
  ready: "rr-e2e-repo-rr-e2e-viewer-001",
  blocked: "rr-e2e-repo-rr-e2e-viewer-002",
  unknown: "rr-e2e-repo-rr-e2e-viewer-003",
} as const;
const profileId = "rr-e2e-skills-gateway-profile";
const releaseId = "rr-e2e-skills-readiness-release";
const profiles = [false, true].map((supported) => ({
  profileRef: supported ? "codex-skills-v1" : "codex-default",
  agentKind: "codex",
  binarySha256: "a".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway", "provider_api"],
  contextGateway: true,
  cancellation: true,
  ...(supported ? { reviewSkillsVersion: 1 } : {}),
}));
const contract = reviewActionV2SupportedContracts()[0]!;
const attestation = {
  producerReleaseId: releaseId,
  distributionKind: "public_reusable",
  actionCommitSha: "a".repeat(40),
  runtimeCommitSha: "b".repeat(40),
  wrapperEntrypointDigest: null,
  runtimeEntrypointDigest: "c".repeat(64),
  contextGatewayPolicyVersion: null,
  contextGatewayEntrypointDigest: null,
  agentProfiles: profiles,
  schemaDigest: contract.schemaDigest,
  canonicalizerDigest: contract.canonicalizerDigest,
  capabilityProfile: "exact_revision_v2",
  protocolLimitsProfileId: "rr-e2e-skills-limits",
  operationalSloProfileId: "rr-e2e-skills-slo",
  reviewInvestigationCapability: null,
  reviewInvestigationCoverageProfileHash: null,
  reviewInvestigationPolicyHash: null,
};

/** Synthetic authority for the real dashboard reader, never a runtime release. */
export function skillsReadinessFixtureEnv() {
  return {
    REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON: JSON.stringify([
      attestation,
    ]),
  };
}

/** Call after the normal Skills fixture and pass skillsReadinessFixtureEnv()
 * into Next's environment. These three repositories use real saved policies,
 * configured producer authority and provisioning facts, with no model/SCM request. */
export async function seedSkillsReadinessFixtures(databaseUrl: string) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("BEGIN");
    const workspaceId = FIXTURES.workspaces.personalViewer;
    const bindingId = "rr-e2e-skills-personal-binding";
    await db.query(
      `INSERT INTO "WorkspaceAccountBinding" (id,"workspaceId","connectionId",state,"updatedAt") VALUES ($1,$2,$3,'active',CURRENT_TIMESTAMP)`,
      [bindingId, workspaceId, FIXTURES.sources.viewerPrimary],
    );
    await db.query(
      `INSERT INTO "WorkspaceProviderProfile" (id,"workspaceId","createdByUserId","credentialKind","authMode","gatewayBindingId","gatewayProfileRef",model,label,"identityKey","updatedAt") VALUES ($1,$2,$3,'gateway_binding','codex_account_gateway',$4,$5,'mimo-v2-pro','Skills fixture',$1,CURRENT_TIMESTAMP)`,
      [
        profileId,
        workspaceId,
        FIXTURES.users.viewer,
        bindingId,
        FIXTURES.gateway.profileId,
      ],
    );
    const result = await db.query<{ id: string; policyJson: string }>(
      `SELECT c.id,v."policyJson" FROM "ReviewConfiguration" c JOIN "ReviewConfigurationVersion" v ON v."configurationId"=c.id WHERE c."workspaceId"=$1 AND c."targetKey"='workspace:default' ORDER BY v.version DESC LIMIT 1`,
      [workspaceId],
    );
    const head = result.rows[0];
    if (!head) throw new Error("skills_readiness_fixture_policy_missing");
    const selection = (agentProfileRef: string) => ({
      profileId,
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
      agentProfileRef,
    });
    const settings = JSON.parse(head.policyJson) as Record<string, unknown>;
    await db.query(
      `INSERT INTO "ReviewConfigurationVersion" (id,"configurationId","workspaceId",version,"schemaVersion","policyJson") VALUES ('rr-e2e-skills-ready-policy-version',$1,$2,2,4,$3)`,
      [
        head.id,
        workspaceId,
        JSON.stringify({
          ...settings,
          providers: [selection("codex-skills-v1")],
        }),
      ],
    );
    const blockedId = SKILLS_READINESS_REPOSITORIES.blocked;
    await db.query(
      `INSERT INTO "ReviewConfiguration" (id,"workspaceId","repositoryId","targetKey","updatedAt") VALUES ('rr-e2e-skills-blocked-policy',$1,$2,$3,CURRENT_TIMESTAMP)`,
      [workspaceId, blockedId, `repo:${blockedId}`],
    );
    await db.query(
      `INSERT INTO "ReviewConfigurationVersion" (id,"configurationId","workspaceId",version,"schemaVersion","policyJson") VALUES ('rr-e2e-skills-blocked-policy-version','rr-e2e-skills-blocked-policy',$1,1,4,$2)`,
      [
        workspaceId,
        JSON.stringify({
          schemaVersion: 4,
          providers: [selection("codex-default")],
        }),
      ],
    );
    for (const repositoryId of [SKILLS_READINESS_REPOSITORIES.ready, blockedId])
      await db.query(
        `INSERT INTO "WorkflowProvisioning" (id,"attemptId","workspaceId","repositoryId",status,branch,"workflowPath","actionVersion","installedWorkflowRequirement","updatedAt") VALUES ($1,$1,$2,$3,'configured','fixture','.github/workflows/reviewrouter-review.yml','fixture','gateway',CURRENT_TIMESTAMP)`,
        [`${repositoryId}-readiness`, workspaceId, repositoryId],
      );
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}
