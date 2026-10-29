import pg from "pg";
import {
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
} from "../../../packages/shared/src/review-model-dispatch-contract.ts";
import { FIXTURES } from "./contracts.ts";

export const RUNTIME_READY_SHA = "a".repeat(40);
export const RUNTIME_OLD_SHA = "b".repeat(40);
export const RUNTIME_FIXTURE_RELEASE_ID = "rr-e2e-runtime-release";
const profileRef = "rr-e2e-runtime-ocr";
const {
  extensionId,
  policyVersion,
  maxRequests,
  maxConcurrentRequests,
  maxRequestBytes,
  maxResponseBytes,
  maxOutputTokens,
} = reviewModelDispatchContract;
const modelDispatchProfile = {
  extensionId,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  policyVersion,
  transports: ["runner_local_responses"],
  wireProtocols: ["openai-responses"],
  defaultAgentProfileRefs: { runner_local_responses: profileRef },
  limits: {
    maxRequests,
    maxConcurrentRequests,
    maxRequestBytes,
    maxResponseBytes,
    maxOutputTokens,
  },
};
const agentProfiles = [
  {
    profileRef,
    agentKind: "ocr",
    binarySha256: "f".repeat(64),
    packageVersion: "1.0.0",
    modelTransports: ["provider_api"],
    contextGateway: false,
    cancellation: true,
    reviewSkillsVersion: 1,
  },
];

/** Synthetic registered metadata exercises real readiness readers. No model,
 * external caller, release witness, or production release is attested here. */
const release = {
  producerReleaseId: RUNTIME_FIXTURE_RELEASE_ID,
  distributionKind: "public_reusable",
  actionCommitSha: RUNTIME_READY_SHA,
  runtimeCommitSha: "c".repeat(40),
  wrapperEntrypointDigest: null,
  runtimeEntrypointDigest: "d".repeat(64),
  contextGatewayPolicyVersion: null,
  contextGatewayEntrypointDigest: null,
  reviewInvestigationCapability: null,
  reviewInvestigationCoverageProfileHash: null,
  reviewInvestigationPolicyHash: null,
  schemaDigest: "e".repeat(64),
  canonicalizerDigest: "9".repeat(64),
  capabilityProfile: "exact_revision_v2",
  protocolLimitsProfileId: "rr-e2e-runtime-limits",
  operationalSloProfileId: "rr-e2e-runtime-slo",
  modelDispatchProfile,
  agentProfiles,
};
export const RUNTIME_UI_ATTESTATIONS = JSON.stringify([release]);

export const RUNTIME_REPOSITORIES = [
  { key: "current", status: "configured", actionVersion: RUNTIME_READY_SHA },
  { key: "update", status: "configured", actionVersion: RUNTIME_OLD_SHA },
  { key: "unknown", status: "configured", actionVersion: "v1" },
  { key: "pending", status: "setup_pr_open", actionVersion: RUNTIME_READY_SHA },
  { key: "failed", status: "failed", actionVersion: RUNTIME_READY_SHA },
] as const;

export async function seedReviewRuntimeFixtures(
  databaseUrl: string,
): Promise<void> {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `UPDATE "GitHubInstallation" SET status='active' WHERE id='rr-e2e-install-personal-viewer'`,
    );
    await db.query(
      `INSERT INTO "ReviewProtocolLimitsV2" ("protocolLimitsProfileId","limitsDigest","maxWorkSlots","maxAttemptsPerSlot","maxObservationBytes","maxObservationFindings","maxProjectionBytes","maxProjectionFindings","maxPublicationOperations","maxPublicationChunks","maxPublicationBodyBytes","maxRequestBatchSize","maxLeaseDurationMs","maxResultReportDurationMs","maxReconciliationDurationMs","registeredAt") VALUES ($1,$2,1,1,1024,1,1024,1,1,1,1024,1,1000,2000,3000,CURRENT_TIMESTAMP)`,
      [release.protocolLimitsProfileId, "1".repeat(64)],
    );
    await db.query(
      `INSERT INTO "ReviewOperationalSloProfileV2" ("operationalSloProfileId","sloDigest","integrationEventDeliveryMs","outboxClaimAgeMs","missingCompletionProcessMs","dueCompletionProcessMs","publicationReconciliationMs","v1DrainMs","admissionMs","pruningBacklogAgeMs","ownerRefs","runbookRefs","registeredAt") VALUES ($1,$2,1000,1000,1000,1000,1000,1000,1000,1000,ARRAY['fixture'],ARRAY['fixture'],CURRENT_TIMESTAMP)`,
      [release.operationalSloProfileId, "2".repeat(64)],
    );
    await db.query(
      `INSERT INTO "ProducerRelease" ("producerReleaseId","distributionKind","actionCommitSha","runtimeCommitSha","runtimeEntrypointDigest","schemaDigest","capabilityProfile","protocolLimitsProfileId","operationalSloProfileId",state,"registeredAt","agentProfilesJson","modelDispatchProfile") VALUES ($1,'public_reusable',$2,$3,$4,$5,$6,$7,$8,'registered',CURRENT_TIMESTAMP,$9,$10::jsonb)`,
      [
        release.producerReleaseId,
        release.actionCommitSha,
        release.runtimeCommitSha,
        release.runtimeEntrypointDigest,
        release.schemaDigest,
        release.capabilityProfile,
        release.protocolLimitsProfileId,
        release.operationalSloProfileId,
        JSON.stringify(agentProfiles),
        JSON.stringify(modelDispatchProfile),
      ],
    );
    await db.query(
      `INSERT INTO "WorkspaceProviderProfile" (id,"workspaceId","createdByUserId","credentialKind","authMode",model,label,"identityKey","updatedAt") VALUES ('rr-e2e-runtime-provider',$1,$2,'user_ci_secret','openrouter_api_key','openai/gpt-5.4-mini','Runtime fixture provider','user_ci_secret:openrouter_api_key:openai/gpt-5.4-mini',CURRENT_TIMESTAMP)`,
      [FIXTURES.workspaces.personalViewer, FIXTURES.users.viewer],
    );
    const workspacePolicy = {
      schemaVersion: 4,
      execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
      blockingPolicy: { failOnSeverity: "critical" },
      limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
      reviewLanguage: null,
      investigationRollout: {
        recordingEnabled: false,
        shadowEnabled: false,
        contextCriticEnabled: false,
        verifiedCleanEnabled: false,
        crossRevisionReplayEnabled: false,
        productionEffectsEnabled: false,
      },
    };
    await db.query(
      `INSERT INTO "ReviewConfiguration" (id,"workspaceId","targetKey","updatedAt") VALUES ('rr-e2e-runtime-config',$1,'workspace:default',CURRENT_TIMESTAMP)`,
      [FIXTURES.workspaces.personalViewer],
    );
    await db.query(
      `INSERT INTO "ReviewConfigurationVersion" (id,"configurationId","workspaceId",version,"schemaVersion","policyJson") VALUES ('rr-e2e-runtime-config-v1','rr-e2e-runtime-config',$1,1,4,$2)`,
      [FIXTURES.workspaces.personalViewer, JSON.stringify(workspacePolicy)],
    );
    for (const [index, item] of RUNTIME_REPOSITORIES.entries()) {
      const id = `rr-e2e-runtime-${item.key}`;
      const name = `runtime-${item.key}`;
      const setupStatus =
        item.status === "failed" ? "needs_attention" : item.status;
      await db.query(
        `INSERT INTO "RepositoryConnection" (id,"workspaceId",provider,"externalRepositoryId","installationId","githubRepositoryId",owner,name,"fullName","defaultBranch",visibility,selected,archived,"setupStatus","updatedAt") VALUES ($1,$2,'github',$3,'rr-e2e-install-personal-viewer',$4,'rr-e2e-viewer',$5,$6,'main','private',true,false,$7::"RepositorySetupStatus",CURRENT_TIMESTAMP)`,
        [
          id,
          FIXTURES.workspaces.personalViewer,
          `runtime-${index}`,
          950000000000 + index,
          name,
          `rr-e2e-viewer/${name}`,
          setupStatus,
        ],
      );
      await db.query(
        `INSERT INTO "ReviewConfiguration" (id,"workspaceId","repositoryId","targetKey","updatedAt") VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)`,
        [`${id}-config`, FIXTURES.workspaces.personalViewer, id, `repo:${id}`],
      );
      await db.query(
        `INSERT INTO "ReviewConfigurationVersion" (id,"configurationId","workspaceId",version,"schemaVersion","policyJson") VALUES ($1,$2,$3,1,4,$4)`,
        [
          `${id}-config-v1`,
          `${id}-config`,
          FIXTURES.workspaces.personalViewer,
          JSON.stringify({
            schemaVersion: 4,
            providers: [
              {
                profileId: "rr-e2e-runtime-provider",
                reasoningEffort: "high",
                agenticContext: true,
                fastMode: false,
                requiredHealthy: true,
              },
            ],
          }),
        ],
      );
      await db.query(
        `INSERT INTO "WorkflowProvisioning" (id,"attemptId","workspaceId","repositoryId",status,branch,"workflowPath","actionVersion","pullRequestUrl","attemptWorkflowRequirement","installedWorkflowRequirement","updatedAt") VALUES ($1,$2,$3,$4,$5::"WorkflowProvisioningStatus",'reviewrouter/setup','.github/workflows/review-router.yml',$6,$7,'provider_api+openrouter',$8,CURRENT_TIMESTAMP)`,
        [
          `${id}-workflow`,
          `${id}-attempt`,
          FIXTURES.workspaces.personalViewer,
          id,
          item.status,
          item.actionVersion,
          item.status === "setup_pr_open"
            ? `https://github.com/rr-e2e-viewer/${name}/pull/1`
            : null,
          item.status === "configured" ? "provider_api+openrouter" : null,
        ],
      );
      await db.query(
        `INSERT INTO "ActionRunHealthReport" (id,"workspaceId","repositoryId","githubRunId","githubRunAttempt","eventName","actionVersion","configVersion","providerSetupState","providerHealth","safeErrorCategory","receivedAt") VALUES ($1,$2,$3,'1','1','pull_request',$4,1,'configured','ok','none',CURRENT_TIMESTAMP-interval '1 minute')`,
        [
          `${id}-health`,
          FIXTURES.workspaces.personalViewer,
          id,
          RUNTIME_OLD_SHA,
        ],
      );
      await db.query(
        `INSERT INTO "ProviderSetupState" (id,"workspaceId","repositoryId","targetKey","providerKind","authMode",state,"updatedAt") VALUES ($1,$2,$3,$4,'openrouter','openrouter_api_key','configured',CURRENT_TIMESTAMP)`,
        [
          `${id}-provider-setup`,
          FIXTURES.workspaces.personalViewer,
          id,
          `repo:${id}`,
        ],
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}
