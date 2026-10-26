import type { WireAccount } from "./gateway-fixture.ts";
import { FIXTURES } from "./contracts.ts";

export const CODEX_MODEL_PROFILE = "openai-codex-oauth-responses-v1";
export const CODEX_SAVED_PROFILE = "rr-e2e-provider-codex-saved";
export const CODEX_SAVED_MODEL = "rr-codex-historical-saved";
export const CODEX_A_MODEL = "rr-codex-a-unseen";
export const CODEX_A_REFRESHED = "rr-codex-a-refreshed";
export const CODEX_B_MODEL = "rr-codex-b-only";

/** Synthetic configured engine metadata for the real settings-form layout.
 * It does not register, run or attest a production release. */
export const ACCOUNT_MODEL_UI_ATTESTATIONS = JSON.stringify([
  {
    producerReleaseId: "rr-e2e-ui-release",
    distributionKind: "public_reusable",
    actionCommitSha: "a".repeat(40),
    runtimeCommitSha: "b".repeat(40),
    wrapperEntrypointDigest: null,
    runtimeEntrypointDigest: "c".repeat(64),
    contextGatewayPolicyVersion: null,
    contextGatewayEntrypointDigest: null,
    reviewInvestigationCapability: null,
    reviewInvestigationCoverageProfileHash: null,
    reviewInvestigationPolicyHash: null,
    schemaDigest: "d".repeat(64),
    canonicalizerDigest: "e".repeat(64),
    capabilityProfile: "exact_revision_v2",
    protocolLimitsProfileId: "rr-e2e-ui-limits",
    operationalSloProfileId: "rr-e2e-ui-slo",
    agentProfiles: [
      {
        profileRef: "rr-e2e-codex-engine",
        agentKind: "codex",
        binarySha256: "f".repeat(64),
        packageVersion: "1.0.0",
        modelTransports: ["account_gateway"],
        cancellation: true,
        contextGateway: true,
      },
    ],
  },
]);

/** Authenticated Gateway HTTP dependency only. No browser response mocking. */
export function createAccountModelsFixture(accounts: readonly WireAccount[]) {
  let phase = "initial";
  const reads: { accountRef: string; forceRefresh: boolean }[] = [];
  return {
    stats() {
      return { phase, reads };
    },
    configure(input: Record<string, unknown>) {
      phase = String(input.phase ?? "initial");
    },
    read(input: Record<string, unknown>) {
      const account = accounts.find(
        (row) => row.accountRef === input.accountRef,
      );
      if (
        !account ||
        account.profileId !== CODEX_MODEL_PROFILE ||
        account.ownerRef !== input.ownerRef ||
        account.authorizationEpoch !== input.expectedAuthorizationEpoch
      )
        return {
          status: 403,
          body: {
            code: "forbidden",
            message: "fixture_account_models_denied",
            diagnosticRef: "fixture-account-models",
          },
        };
      reads.push({
        accountRef: account.accountRef,
        forceRefresh: input.forceRefresh === true,
      });
      if (input.forceRefresh === true) phase = "refreshed";
      if (["unavailable", "unknown", "unsupported"].includes(phase))
        return { status: 200, body: { status: phase } };
      const own =
        account.accountRef === FIXTURES.gateway.accounts.viewerPrimary;
      const models =
        phase === "empty"
          ? []
          : own
            ? phase === "foreign-only"
              ? []
              : [phase === "refreshed" ? CODEX_A_REFRESHED : CODEX_A_MODEL]
            : phase === "foreign-only"
              ? [CODEX_B_MODEL, CODEX_A_MODEL]
              : [CODEX_B_MODEL];
      const now = Date.now();
      return {
        status: 200,
        body: {
          status: "snapshot",
          physicalGeneration: "fixture-private-generation",
          principalVersion: "fixture-private-principal",
          source: "codex",
          fetchedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 300000).toISOString(),
          models: models.map((modelId) => ({
            modelId,
            reasoning: { allowed: ["minimal", "high"], default: "high" },
            fast: { allowed: ["balanced"], default: "balanced" },
            tools: { allowed: ["function"], default: "function" },
          })),
        },
      };
    },
  };
}
