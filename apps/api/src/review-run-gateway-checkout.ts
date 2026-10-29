import {
  isProviderApiAuthMode,
  providerApiDescriptors,
  parseReviewReviewerPlan,
  reviewerPlanContract,
} from "@reviewrouter/shared";
import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import { accountModelDiscoveryProfile } from "@agent-teams/account-gateway/contracts";
import {
  gatewayModelSettingsRuntimeEnvKey,
  serializeSelectedGatewayModelSettings,
  type ReadSelectedGatewayModelSettings,
} from "./review-run-gateway-model-settings.js";
import { Buffer, isUtf8 } from "node:buffer";
import { performance } from "node:perf_hooks";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  mapConfigToRuntimeEnv,
  parseReviewConfigurationStrict,
  assertProviderApiDirectConfigurationSupported,
} from "@reviewrouter/features-review-config";
import {
  prDescriptionContract,
  lifecycleVerificationContract,
  providerApiCheckoutCompanionContract,
} from "@reviewrouter/shared";
import {
  canonicalCodexRotatingProviderId,
  CodexRotatingT0WorkflowSchemaVersion,
} from "@reviewrouter/features-codex-oauth-rotating";
import {
  canonicalJson,
  buildReviewRunReviewerPlan,
  getPrimaryReviewRunReviewer,
  getReviewRunGatewayAllocation,
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayOwnedIdentity,
  type ManageReviewRunAuthorizations,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunGatewaySelection,
  type ReviewRunGatewayAllocation,
} from "@reviewrouter/features-review-run-control";

/** SCM capability for CI. This seam has no model/provider credential authority. */
export type AccountGatewayCheckoutCapability = Readonly<{
  protocolVersion: 1;
  repository: string;
  headSha: string;
  token: string;
  expiresAt: string;
  permissions: Readonly<{ contents: "read"; pullRequests: "read" }>;
  runtimeConfig: Readonly<{
    protocolVersion: 1;
    configVersion: number;
    runtimeEnv: Readonly<Record<string, string>>;
  }>;
}>;
export type ReviewRunGatewayCheckoutTarget = Readonly<{
  githubInstallationId: string;
  githubRepositoryId: string;
  repositoryFullName: string;
}>;
type ReadIssuer = {
  issueContentsReadToken(input: ReviewRunGatewayCheckoutTarget): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
    readonly permissions: {
      readonly contents: "read";
      readonly pullRequests: "read";
    };
  }>;
};
type CheckoutSelectors = Readonly<{
  providerInstanceId: string;
  workflowSchemaVersion: number;
}>;
type ProviderApiCheckoutSelectors = Readonly<{
  providerApiAuthMode: ProviderApiAuthMode;
  workflowSchemaVersion: 2;
}>;
class CheckoutFailure extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

type CheckoutDependencies = {
  readonly authorizations: Pick<
    ManageReviewRunAuthorizations,
    "resolveReviewRunAuthorizationToken"
  >;
  readonly resolveRepository: (
    authorization: ReviewRunAuthorization,
  ) => Promise<ReviewRunGatewayCheckoutTarget | null>;
  readonly confirmAuthority: (
    token: string,
    authorization: ReviewRunAuthorization,
    target: ReviewRunGatewayCheckoutTarget,
  ) => Promise<boolean>;
  readonly issuer?: ReadIssuer;
  readonly lifecycleObservationAuthors?: readonly string[];
  readonly maxInFlight: number;
  readonly timeoutMs: number;
};

export function createReviewRunGatewayCheckout(
  input: CheckoutDependencies & {
    readonly bindings: ReviewRunGatewayExecutionBindingPort;
    readonly readSelectedModelSettings?: ReadSelectedGatewayModelSettings;
  },
) {
  return createReviewRunCheckout({
    ...input,
    modelTransport: "account_gateway",
  });
}

export function createReviewRunProviderApiCheckout(
  input: CheckoutDependencies,
) {
  return createReviewRunCheckout({ ...input, modelTransport: "provider_api" });
}

function createReviewRunCheckout(
  input: CheckoutDependencies &
    (
      | {
          readonly modelTransport: "account_gateway";
          readonly bindings: ReviewRunGatewayExecutionBindingPort;
          readonly readSelectedModelSettings?: ReadSelectedGatewayModelSettings;
        }
      | { readonly modelTransport: "provider_api" }
    ),
) {
  if (
    !Number.isInteger(input.maxInFlight) ||
    input.maxInFlight < 1 ||
    input.maxInFlight > 4 ||
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1 ||
    input.timeoutMs > 30_000
  )
    throw new Error("gateway_checkout_policy_invalid");
  const observationAuthors = input.lifecycleObservationAuthors;
  if (
    observationAuthors &&
    (observationAuthors.length > 64 ||
      observationAuthors.some(
        (author) =>
          typeof author !== "string" ||
          !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}(?:\[bot\])?$/.test(author),
      ))
  )
    throw new Error("gateway_checkout_observation_authors_invalid");
  const observationAuthorsJson =
    observationAuthors === undefined
      ? undefined
      : JSON.stringify([...observationAuthors]);
  return Object.freeze({
    modelTransport: input.modelTransport,
    maxInFlight: input.maxInFlight,
    timeoutMs: input.timeoutMs,
    async issue(
      token: string,
      signal: AbortSignal,
      selectors: CheckoutSelectors | ProviderApiCheckoutSelectors,
    ): Promise<AccountGatewayCheckoutCapability> {
      const deadline = performance.now() + input.timeoutMs;
      const checkTime = () => {
        if (signal.aborted || performance.now() >= deadline)
          throw new CheckoutFailure("checkout_cancelled", 503);
      };
      // Await every dependency to settlement. The existing App issuer has no
      // AbortSignal contract; racing it would free capacity with minting still live.
      const checked = async <T>(work: () => Promise<T>): Promise<T> => {
        checkTime();
        const value = await work();
        checkTime();
        return value;
      };
      const issuer = input.issuer;
      if (!issuer) throw new CheckoutFailure("checkout_unavailable", 503);
      const resolve = () =>
        checked(() =>
          input.authorizations.resolveReviewRunAuthorizationToken({ token }),
        );
      const first = await resolve();
      if (first.status !== "valid")
        throw new CheckoutFailure("authorization_denied", 401);
      const auth = first.authorization;
      const canonical = auth.runtimeSnapshotCanonicalJson;
      const snapshot = parseReviewRunRuntimeSnapshot(canonical);
      const primaryReviewer =
        snapshot?.snapshotVersion === 4
          ? getPrimaryReviewRunReviewer(snapshot)
          : null;
      const primaryAgent =
        snapshot?.snapshotVersion === 3
          ? snapshot.agent
          : primaryReviewer?.agentProfile;
      const gatewaySelections: readonly Readonly<{
        providerIndex: number;
        reviewerId?: string;
        allocationId?: string;
        gateway: ReviewRunGatewaySelection | ReviewRunGatewayAllocation;
      }>[] =
        snapshot?.snapshotVersion === 4
          ? snapshot.reviewers.map((reviewer) => {
              const gateway = getReviewRunGatewayAllocation(
                snapshot,
                reviewer.transport.allocationId,
              );
              if (!gateway)
                throw new CheckoutFailure("checkout_unavailable", 403);
              return {
                providerIndex: reviewer.providerIndex,
                reviewerId: reviewer.reviewerId,
                allocationId: gateway.allocationId,
                gateway,
              };
            })
          : snapshot?.gateway
            ? [
                {
                  providerIndex: snapshot.gateway.providerIndex,
                  gateway: snapshot.gateway,
                },
              ]
            : [];
      if (
        !canonical ||
        !snapshot ||
        !primaryAgent ||
        (input.modelTransport === "account_gateway"
          ? gatewaySelections.length === 0 ||
            gatewaySelections.some((selection) => !selection.gateway.limits) ||
            snapshot.deadline !== auth.maxExpiresAt.toISOString()
          : snapshot.snapshotVersion !== 3 ||
            snapshot.gateway !== null ||
            primaryAgent.agentKind !== "codex" ||
            !primaryAgent.modelTransports.includes("provider_api") ||
            new Date(snapshot.deadline).getTime() >
              auth.maxExpiresAt.getTime() ||
            new Date(snapshot.deadline).getTime() <= Date.now())
      )
        throw new CheckoutFailure("checkout_unavailable", 403);
      let directConfiguration:
        | ReturnType<typeof parseReviewConfigurationStrict>
        | undefined;
      let directMode: ProviderApiAuthMode | undefined;
      if (input.modelTransport === "provider_api") {
        try {
          directConfiguration = parseReviewConfigurationStrict(
            JSON.parse(snapshot.configurationCanonicalJson),
          );
          directMode =
            assertProviderApiDirectConfigurationSupported(directConfiguration);
          if (
            canonicalJson(directConfiguration) !==
            snapshot.configurationCanonicalJson
          )
            throw new Error();
        } catch {
          throw new CheckoutFailure("checkout_unavailable", 403);
        }
      }
      const executionEpochs = new Map<string, number>();
      const allocationSettingsEpochs = new Map<string, number>();
      const unavailable = new Map<
        string,
        "allocation_unavailable" | "model_settings_unavailable"
      >();
      const selectedModelSettings = new Map<
        string,
        Awaited<ReturnType<ReadSelectedGatewayModelSettings>>
      >();
      const markAllocationUnavailable = (allocationKey: string) => {
        for (const selection of gatewaySelections) {
          if ((selection.allocationId ?? "legacy") !== allocationKey) continue;
          const reviewerId = selection.reviewerId ?? "legacy";
          unavailable.set(reviewerId, "allocation_unavailable");
          selectedModelSettings.delete(reviewerId);
        }
      };
      const configuration =
        directConfiguration ??
        parseReviewConfigurationStrict(
          JSON.parse(snapshot.configurationCanonicalJson),
        );
      const provider =
        configuration.providers[
          primaryReviewer?.providerIndex ??
            gatewaySelections[0]?.providerIndex ??
            0
        ];
      if (
        (input.modelTransport === "account_gateway" &&
          (gatewaySelections.some(({ providerIndex, gateway }) => {
            const selected = configuration.providers[providerIndex];
            return (
              selected?.authMode !== "codex_account_gateway" ||
              selected.gatewayBindingId !== gateway.bindingId ||
              selected.gatewayProfileRef !== gateway.profileRef
            );
          }) ||
            (snapshot.snapshotVersion === 4
              ? gatewaySelections.length !== configuration.providers.length
              : configuration.providers.find(
                  (entry) => entry.kind === "codex",
                ) !== provider))) ||
        canonicalJson(configuration) !== snapshot.configurationCanonicalJson
      )
        throw new CheckoutFailure("checkout_unavailable", 403);
      const liveBinding = async () => {
        if (input.modelTransport !== "account_gateway") return;
        const seen = new Set<string>();
        for (const selection of gatewaySelections) {
          const key = selection.allocationId ?? "legacy";
          if (seen.has(key)) continue;
          seen.add(key);
          try {
            const result = await checked(() =>
              input.bindings.read({
                authorizationId: auth.authorizationId,
                identity: reviewRunGatewayOwnedIdentity(auth),
                runtimeSnapshotCanonicalJson: canonical,
                ...(selection.allocationId === undefined
                  ? {}
                  : { allocationId: selection.allocationId }),
              }),
            );
            // Checkout precedes first inference, so an unprepared allocation has no attachment.
            const settingsEpoch = allocationSettingsEpochs.get(key);
            if (
              result.status !== "live" ||
              (settingsEpoch !== undefined &&
                result.binding &&
                result.binding.authorizationEpoch !== settingsEpoch)
            )
              throw new CheckoutFailure("authorization_denied", 401);
            if (result.binding)
              executionEpochs.set(key, result.binding.authorizationEpoch);
          } catch (error) {
            checkTime();
            if (snapshot.snapshotVersion !== 4) throw error;
            markAllocationUnavailable(key);
          }
        }
      };
      const target = await checked(() => input.resolveRepository(auth));
      if (
        !target ||
        target.repositoryFullName.length > 201 ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target.repositoryFullName) ||
        !/^[a-f0-9]{40}$/.test(auth.headSha)
      )
        throw new CheckoutFailure("authorization_denied", 401);
      const savedTarget = Object.freeze({ ...target });
      if (
        input.modelTransport === "account_gateway"
          ? !("providerInstanceId" in selectors) ||
            selectors.providerInstanceId !==
              canonicalCodexRotatingProviderId(
                savedTarget.githubRepositoryId,
              ) ||
            selectors.workflowSchemaVersion !==
              CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2
          : !("providerApiAuthMode" in selectors) ||
            selectors.providerApiAuthMode !== directMode ||
            selectors.workflowSchemaVersion !==
              providerApiCheckoutCompanionContract.workflowSchemaVersion
      )
        throw new CheckoutFailure("authorization_denied", 401);
      await liveBinding();
      if (
        !(await checked(() => input.confirmAuthority(token, auth, savedTarget)))
      )
        throw new CheckoutFailure("authorization_denied", 401);
      const readModelSettings =
        input.modelTransport === "account_gateway"
          ? input.readSelectedModelSettings
          : undefined;
      for (const selection of input.modelTransport === "account_gateway"
        ? gatewaySelections
        : []) {
        if (!accountModelDiscoveryProfile(selection.gateway.profileRef))
          continue;
        const reviewerId = selection.reviewerId ?? "legacy";
        if (unavailable.has(reviewerId)) continue;
        const allocationKey = selection.allocationId ?? "legacy";
        const executionAuthorizationEpoch = executionEpochs.get(allocationKey);
        try {
          if (!readModelSettings)
            throw new CheckoutFailure("checkout_unavailable", 503);
          const modelSettings = await checked(() =>
            readModelSettings({
              authorization: auth,
              signal,
              ...(selection.reviewerId === undefined
                ? {}
                : { reviewerId: selection.reviewerId }),
              ...(executionAuthorizationEpoch === undefined
                ? {}
                : { executionAuthorizationEpoch }),
            }),
          );
          if (
            (selection.gateway.expectedAuthorizationEpoch !== undefined &&
              modelSettings.authorizationEpoch !==
                selection.gateway.expectedAuthorizationEpoch) ||
            (executionAuthorizationEpoch !== undefined &&
              modelSettings.authorizationEpoch !==
                executionAuthorizationEpoch) ||
            (allocationSettingsEpochs.has(allocationKey) &&
              allocationSettingsEpochs.get(allocationKey) !==
                modelSettings.authorizationEpoch)
          ) {
            if (snapshot.snapshotVersion !== 4)
              throw new CheckoutFailure("authorization_denied", 401);
            markAllocationUnavailable(allocationKey);
          } else {
            selectedModelSettings.set(reviewerId, modelSettings);
            allocationSettingsEpochs.set(
              allocationKey,
              modelSettings.authorizationEpoch,
            );
          }
        } catch (error) {
          checkTime();
          if (snapshot.snapshotVersion !== 4) throw error;
          unavailable.set(reviewerId, "model_settings_unavailable");
        }
        await liveBinding();
        if (
          !(await checked(() =>
            input.confirmAuthority(token, auth, savedTarget),
          ))
        )
          throw new CheckoutFailure("authorization_denied", 401);
      }
      const capability = await checked(() =>
        issuer.issueContentsReadToken(savedTarget),
      );
      // Copy only the issuer's actual SCM-read primitives, never manufacture expiry.
      const readToken = capability.token;
      const expiry = capability.expiresAt.getTime();
      if (
        typeof readToken !== "string" ||
        !/^[A-Za-z0-9._~-]{1,16384}$/.test(readToken) ||
        !Number.isFinite(expiry) ||
        capability.permissions.contents !== "read" ||
        capability.permissions.pullRequests !== "read" ||
        Object.keys(capability.permissions).sort().join(",") !==
          "contents,pullRequests"
      )
        throw new CheckoutFailure("checkout_unavailable", 503);
      // All issuer/SCM awaits precede the final protected local confirmation.
      const fresh = await resolve();
      if (
        fresh.status !== "valid" ||
        fresh.authorization.authorizationId !== auth.authorizationId ||
        fresh.authorization.version !== auth.version ||
        fresh.authorization.runtimeSnapshotCanonicalJson !== canonical ||
        canonicalJson(reviewRunGatewayOwnedIdentity(fresh.authorization)) !==
          canonicalJson(reviewRunGatewayOwnedIdentity(auth))
      )
        throw new CheckoutFailure("authorization_denied", 401);
      const currentTarget = await checked(() =>
        input.resolveRepository(fresh.authorization),
      );
      if (canonicalJson(currentTarget) !== canonicalJson(savedTarget))
        throw new CheckoutFailure("authorization_denied", 401);
      await liveBinding();
      if (
        !(await checked(() => input.confirmAuthority(token, auth, savedTarget)))
      )
        throw new CheckoutFailure("authorization_denied", 401);
      if (expiry <= Date.now() + 30_000)
        throw new CheckoutFailure("checkout_unavailable", 503);
      // Export only the admitted safe settings after the final authority checks.
      // Never reread current configuration or expose the private gateway selection.
      const runtimeEnv = mapConfigToRuntimeEnv(configuration);
      const modelSettings = selectedModelSettings.get(
        primaryReviewer?.reviewerId ?? "legacy",
      );
      if (
        modelSettings?.settings !== undefined &&
        snapshot.snapshotVersion === 3
      )
        runtimeEnv[gatewayModelSettingsRuntimeEnvKey] =
          serializeSelectedGatewayModelSettings(
            modelSettings.settings,
            provider!.model,
            snapshot.gateway!.profileRef,
          );
      if (snapshot.snapshotVersion === 4) {
        const plan = buildReviewRunReviewerPlan(
          snapshot,
          new Map(
            [...selectedModelSettings].map(
              ([reviewerId, selected]) =>
                [reviewerId, selected.settings] as const,
            ),
          ),
        );
        runtimeEnv[reviewerPlanContract.runtimeEnvKey] = canonicalJson(
          parseReviewReviewerPlan({
            ...plan,
            reviewers: plan.reviewers.map((reviewer) => ({
              ...reviewer,
              ...(unavailable.has(reviewer.reviewerId)
                ? { unavailableReason: unavailable.get(reviewer.reviewerId) }
                : {}),
            })),
          }),
        );
      }
      if (snapshot.contextToolsPlanCanonicalJson !== undefined) {
        runtimeEnv.REVIEW_ROUTER_CONTEXT_TOOLS_PLAN_JSON =
          snapshot.contextToolsPlanCanonicalJson;
      }
      // Only the admitted agent definition is exported, never today's setting.
      runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON = canonicalJson(primaryAgent);
      runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_DIGEST =
        snapshot.snapshotVersion === 3
          ? snapshot.agentProfileDigest
          : primaryReviewer!.agentProfileDigest;
      if (snapshot.prDescriptionCapability !== undefined) {
        runtimeEnv[prDescriptionContract.capabilityRuntimeEnvKey] =
          canonicalJson(snapshot.prDescriptionCapability);
      }
      if (snapshot.lifecycleVerificationCapability !== undefined) {
        runtimeEnv[lifecycleVerificationContract.capabilityRuntimeEnvKey] =
          canonicalJson(snapshot.lifecycleVerificationCapability);
      }
      if (snapshot.lifecycleVerificationUnavailableReason !== undefined) {
        runtimeEnv[
          lifecycleVerificationContract.unavailableReasonRuntimeEnvKey
        ] = snapshot.lifecycleVerificationUnavailableReason;
      }
      // Protected server observation policy; no lifecycle mutation permission.
      if (observationAuthorsJson !== undefined) {
        runtimeEnv.REVIEW_ROUTER_LIFECYCLE_OBSERVATION_AUTHORS =
          observationAuthorsJson;
      }
      if (
        !provider ||
        (input.modelTransport === "account_gateway"
          ? runtimeEnv.CODEX_MODEL !== provider.model
          : runtimeEnv.REVIEW_AUTH_MODE !== directMode ||
            !directMode ||
            runtimeEnv.REVIEW_PROVIDERS !==
              `${providerApiDescriptors[directMode].runtimePrefix}/${provider.model}`) ||
        runtimeEnv.CODEX_REASONING_EFFORT !== provider.reasoningEffort ||
        runtimeEnv.CODEX_AGENTIC_CONTEXT !== String(provider.agenticContext) ||
        runtimeEnv.CODEX_FAST_MODE !== String(provider.fastMode)
      )
        throw new CheckoutFailure("checkout_unavailable", 403);
      checkTime();
      const result = Object.freeze({
        protocolVersion: 1 as const,
        repository: savedTarget.repositoryFullName,
        headSha: auth.headSha,
        token: readToken,
        expiresAt: new Date(expiry).toISOString(),
        permissions: Object.freeze({ contents: "read", pullRequests: "read" }),
        runtimeConfig: Object.freeze({
          protocolVersion: 1 as const,
          configVersion: snapshot.configurationVersion,
          runtimeEnv: Object.freeze(runtimeEnv),
        }),
      });
      const maxResponseBytes =
        snapshot.snapshotVersion === 4 ? 131_072 : 65_536;
      if (Buffer.byteLength(JSON.stringify(result)) > maxResponseBytes)
        throw new CheckoutFailure("checkout_unavailable", 503);
      return result;
    },
  });
}
export type ReviewRunGatewayCheckout = ReturnType<
  typeof createReviewRunGatewayCheckout
>;

export { registerReviewRunCheckoutRoute as registerReviewRunGatewayCheckoutRoute };

export async function registerReviewRunCheckoutRoute(
  app: FastifyInstance,
  checkout: ReviewRunGatewayCheckout,
) {
  const active = new Set<AbortController>();
  let stopping = false;
  await app.register(async (scope) => {
    type Reservation = {
      controller: AbortController;
      working: boolean;
      finish: () => void;
    };
    const reservations = new WeakMap<FastifyRequest, Reservation>();
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 512 },
      (_request, body, done) => done(null, body),
    );
    scope.addHook("onRequest", async (request, reply) => {
      reply.header("cache-control", "no-store");
      if (stopping || active.size >= checkout.maxInFlight)
        return reply.code(503).send({ error: { code: "checkout_saturated" } });
      // Reserve before parsing a body or doing token verification, SQL or SCM work.
      const controller = new AbortController();
      active.add(controller);
      let finished = false;
      const cancel = () => {
        controller.abort();
        if (!reservation.working) reservation.finish();
      };
      const timer = setTimeout(() => {
        cancel();
        reply.raw.destroy();
      }, checkout.timeoutMs);
      const reservation: Reservation = {
        controller,
        working: false,
        finish: () => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          request.raw.removeListener("aborted", cancel);
          reply.raw.removeListener("close", cancel);
          active.delete(controller);
        },
      };
      reservations.set(request, reservation);
      request.raw.once("aborted", cancel);
      reply.raw.once("close", cancel);
      if (request.raw.aborted) cancel();
    });
    scope.addHook("onResponse", async (request) => {
      const reservation = reservations.get(request);
      if (reservation && !reservation.working) reservation.finish();
    });
    scope.setErrorHandler((_error, request, reply) => {
      reservations.get(request)?.finish();
      reply
        .header("cache-control", "no-store")
        .code(400)
        .send({ error: { code: "invalid_request" } });
    });
    scope.post(
      checkout.modelTransport === "provider_api"
        ? providerApiCheckoutCompanionContract.path
        : "/api/action/v2/account-gateway/checkout",
      { bodyLimit: 512 },
      async (request, reply) => {
        const reservation = reservations.get(request);
        try {
          if (!reservation || reservation.controller.signal.aborted)
            throw new CheckoutFailure("checkout_cancelled", 503);
          reservation.working = true;
          const { token, selectors } = parseRequest(
            request,
            checkout.modelTransport,
          );
          const result = await checkout.issue(
            token,
            reservation.controller.signal,
            selectors,
          );
          if (reservation.controller.signal.aborted)
            throw new CheckoutFailure("checkout_cancelled", 503);
          return reply.code(200).send(result);
        } catch (error) {
          const failure =
            error instanceof CheckoutFailure
              ? error
              : new CheckoutFailure("checkout_unavailable", 503);
          return reply
            .code(failure.statusCode)
            .send({ error: { code: failure.code } });
        } finally {
          reservation?.finish();
        }
      },
    );
  });
  app.addHook("preClose", async () => {
    stopping = true;
    for (const controller of active) controller.abort();
  });
}

function parseRequest(
  request: FastifyRequest,
  modelTransport: "account_gateway" | "provider_api",
): {
  token: string;
  selectors: CheckoutSelectors | ProviderApiCheckoutSelectors;
} {
  const raw = request.raw.rawHeaders;
  let bytes = 0;
  const counts = new Map<string, number>();
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!;
    const value = raw[i + 1]!;
    bytes += Buffer.byteLength(name) + Buffer.byteLength(value) + 4;
    const key = name.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (
    bytes > 16_384 ||
    request.raw.url?.includes("?") ||
    counts.get("authorization") !== 1 ||
    counts.get("content-type") !== 1 ||
    (counts.get("content-length") ?? 0) > 1 ||
    (counts.get("transfer-encoding") ?? 0) > 1 ||
    request.headers["content-encoding"] !== undefined ||
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers["content-type"] ?? "",
    ) ||
    !Buffer.isBuffer(request.body) ||
    request.body.length > 512 ||
    !isUtf8(request.body)
  )
    throw new CheckoutFailure("invalid_request", 400);
  const header = request.headers.authorization;
  if (
    typeof header !== "string" ||
    header.length > 16_384 ||
    !/^Bearer [A-Za-z0-9._~-]+$/.test(header)
  )
    throw new CheckoutFailure("authorization_denied", 401);
  // Exactly two JSON scalar members. Decode keys before checking uniqueness so
  // escaped duplicate names cannot disappear through JSON.parse's last-wins rule.
  const jsonString =
    '"(?:[^"\\\\\\x00-\\x1f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const jsonNumber = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?";
  const whitespace = "[ \\t\\r\\n]*";
  const member = `(${jsonString})${whitespace}:${whitespace}(${jsonString}|${jsonNumber})`;
  const members = new RegExp(
    `^${whitespace}\\{${whitespace}${member}${whitespace},${whitespace}${member}${whitespace}\\}${whitespace}$`,
  ).exec(request.body.toString("utf8"));
  if (!members || JSON.parse(members[1]!) === JSON.parse(members[3]!))
    throw new CheckoutFailure("invalid_request", 400);
  const selectors: unknown = JSON.parse(request.body.toString("utf8"));
  if (modelTransport === "provider_api") {
    if (
      typeof selectors !== "object" ||
      !selectors ||
      Object.keys(selectors).sort().join(",") !==
        "providerApiAuthMode,workflowSchemaVersion" ||
      !("providerApiAuthMode" in selectors) ||
      !isProviderApiAuthMode(selectors.providerApiAuthMode) ||
      !("workflowSchemaVersion" in selectors) ||
      selectors.workflowSchemaVersion !==
        providerApiCheckoutCompanionContract.workflowSchemaVersion
    )
      throw new CheckoutFailure("invalid_request", 400);
    return {
      token: header.slice(7),
      selectors: {
        providerApiAuthMode: selectors.providerApiAuthMode,
        workflowSchemaVersion:
          providerApiCheckoutCompanionContract.workflowSchemaVersion,
      },
    };
  }
  if (
    typeof selectors !== "object" ||
    !selectors ||
    Object.keys(selectors).sort().join(",") !==
      "providerInstanceId,workflowSchemaVersion" ||
    !("providerInstanceId" in selectors) ||
    typeof selectors.providerInstanceId !== "string" ||
    !("workflowSchemaVersion" in selectors) ||
    typeof selectors.workflowSchemaVersion !== "number" ||
    !Number.isFinite(selectors.workflowSchemaVersion)
  )
    throw new CheckoutFailure("invalid_request", 400);
  return {
    token: header.slice(7),
    selectors: {
      providerInstanceId: selectors.providerInstanceId,
      workflowSchemaVersion: selectors.workflowSchemaVersion,
    },
  };
}
