import { createHash } from "node:crypto";
import type { WireAccount } from "./gateway-fixture.ts";
import { FIXTURES } from "./contracts.js";

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
export function createAccountModelsFixture(accounts: WireAccount[]) {
  let phase = "initial";
  let importsEnabled = false;
  const reads: { accountRef: string; forceRefresh: boolean }[] = [];
  const infoReads: { ownerRef: string; accountRefs: string[] }[] = [];
  const imports: {
    action: "connect" | "reconnect";
    method: "refresh_token" | "oauth_auth_json";
    operationRef: string;
    accountRef: string;
    metadataRevision: number;
    authorizationEpoch: number;
  }[] = [];
  const operations = new Map<
    string,
    {
      intent: string;
      operation: {
        operationRef: string;
        state: "applied";
        result: {
          kind: "account";
          accountRef: string;
          metadataRevision: number;
          authorizationEpoch: number;
        };
      };
    }
  >();
  const denied = () => ({
    status: 403,
    body: {
      code: "forbidden",
      traceRef: "codex-browser-fixture-denied",
      effect: "not_dispatched",
      retry: { kind: "never" },
    },
  });
  return {
    stats() {
      return { phase, reads, infoReads, importsEnabled, imports };
    },
    configure(input: Record<string, unknown>) {
      if (input.phase !== undefined) phase = String(input.phase);
      if (typeof input.importsEnabled === "boolean")
        importsEnabled = input.importsEnabled;
    },
    methods() {
      return [
        {
          kind: "browser",
          create: false,
          reconnect: false,
          completionInputKind: "callback_url",
          callbackMode: "automatic",
        },
        ...(importsEnabled
          ? (["refresh_token", "oauth_auth_json"] as const).map((method) => ({
              kind: "credential_import",
              method,
              maxBytes: 65536,
              create: true,
              reconnect: true,
            }))
          : []),
      ];
    },
    info(input: Record<string, unknown>) {
      const refs = input.accountRefs;
      if (
        typeof input.ownerRef !== "string" ||
        !Array.isArray(refs) ||
        refs.length > 50 ||
        refs.some(
          (ref) =>
            typeof ref !== "string" ||
            !accounts.some(
              (row) =>
                row.accountRef === ref && row.ownerRef === input.ownerRef,
            ),
        )
      )
        return denied();
      infoReads.push({ ownerRef: input.ownerRef, accountRefs: [...refs] });
      const known = <T>(value: T) => ({
        status: "known",
        value,
        source: "provider_api",
        observedAt: "2026-11-20T12:00:00Z",
        freshness: "current",
      });
      return {
        status: 200,
        body: {
          contract: "account-info/v1",
          accounts: refs.map((accountRef) => {
            const account = accounts.find(
              (row) => row.accountRef === accountRef,
            )!;
            const workspace = accountRef === FIXTURES.gateway.accounts.orgAlpha;
            return {
              accountRef,
              metadataRevision: account.metadataRevision,
              authorizationEpoch: account.authorizationEpoch,
              info:
                account.profileId !== CODEX_MODEL_PROFILE
                  ? { status: "unsupported" }
                  : {
                      status: "available",
                      infoRevision: `fixture-codex-info-${account.metadataRevision}`,
                      fields: {
                        email: known(
                          workspace
                            ? "workspace-codex@example.invalid"
                            : accountRef ===
                                FIXTURES.gateway.accounts.viewerPrimary
                              ? "selected-codex@example.invalid"
                              : "imported-codex@example.invalid",
                        ),
                        accountLabel: { status: "unknown" },
                        subscription: known({
                          code: workspace ? "team" : "plus",
                          label: workspace ? "Team" : "Plus",
                          scope: workspace ? "organization" : "personal",
                          endsAt: {
                            kind: "date",
                            value: workspace ? "2027-01-31" : "2026-12-31",
                          },
                        }),
                        credentialExpiresAt: known("2026-12-15T13:00:00Z"),
                        privacyMode: known("private"),
                      },
                    },
            };
          }),
        },
      };
    },
    operation(operationRef: string) {
      return operations.get(operationRef)?.operation;
    },
    import(path: string, input: Record<string, unknown>) {
      const match = path.match(/^\/v1\/accounts\/([^/]+)\/reconnect$/);
      const previous = match
        ? accounts.find((row) => row.accountRef === match[1])
        : undefined;
      if ((previous?.profileId ?? input.profileId) !== CODEX_MODEL_PROFILE)
        return null;
      const action = match ? "reconnect" : "connect";
      const ownerRef = accounts.find(
        (row) => row.accountRef === FIXTURES.gateway.accounts.viewerPrimary,
      )!.ownerRef;
      const credential = input.credential as
        | { kind?: unknown; method?: unknown; value?: unknown }
        | undefined;
      const method = credential?.method;
      if (
        !importsEnabled ||
        (path !== "/v1/accounts" && !match) ||
        typeof input.operationId !== "string" ||
        !input.operationId ||
        credential?.kind !== "credential_import" ||
        Object.keys(credential).sort().join(",") !== "kind,method,value" ||
        (method !== "refresh_token" && method !== "oauth_auth_json") ||
        (match ? previous?.ownerRef !== ownerRef : input.ownerRef !== ownerRef)
      )
        return denied();
      // This fixture accepts only fixed synthetic inputs; it never parses or
      // exchanges provider credentials, and retains no credential or digest.
      const marker = action === "reconnect" ? "reconnect-" : "";
      const expected =
        method === "refresh_token"
          ? `synthetic-codex-${marker}refresh-token`
          : `{"tokens":{"refresh_token":"synthetic-codex-${marker}auth-json"}}`;
      if (credential.value !== expected) return denied();
      const displayName = previous?.displayName ?? input.displayName;
      if (
        typeof displayName !== "string" ||
        !displayName ||
        displayName.length > 120
      )
        return denied();
      const intent = JSON.stringify({
        action,
        ownerRef,
        accountRef: previous?.accountRef,
        method,
        displayName,
        expectedMetadataRevision: input.expectedMetadataRevision,
      });
      const saved = operations.get(input.operationId);
      if (saved)
        return saved.intent === intent
          ? { status: 200, body: saved.operation }
          : denied();
      if (
        match &&
        previous?.metadataRevision !== input.expectedMetadataRevision
      )
        return denied();
      const account: WireAccount = {
        accountRef:
          previous?.accountRef ??
          `codex-import-${createHash("sha256").update(input.operationId).digest("hex").slice(0, 20)}`,
        ownerRef,
        profileId: CODEX_MODEL_PROFILE,
        displayName,
        state: "active",
        metadataRevision: (previous?.metadataRevision ?? 0) + 1,
        authorizationEpoch: (previous?.authorizationEpoch ?? 0) + 1,
      };
      if (previous) accounts.splice(accounts.indexOf(previous), 1, account);
      else accounts.push(account);
      const operation = {
        operationRef: input.operationId,
        state: "applied" as const,
        result: {
          kind: "account" as const,
          accountRef: account.accountRef,
          metadataRevision: account.metadataRevision,
          authorizationEpoch: account.authorizationEpoch,
        },
      };
      operations.set(input.operationId, { intent, operation });
      imports.push({
        action,
        method,
        operationRef: input.operationId,
        accountRef: account.accountRef,
        metadataRevision: account.metadataRevision,
        authorizationEpoch: account.authorizationEpoch,
      });
      return { status: 200, body: operation };
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
