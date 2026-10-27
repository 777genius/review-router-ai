import {
  isProviderApiAuthMode,
  providerApiDescriptors,
  reviewModelTransportForAuthMode,
  type ReviewModelTransport,
} from "@reviewrouter/shared";
import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import {
  codexOAuthModelSettingsProfile,
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
  providerRuntimeAuthMode,
} from "@reviewrouter/features-review-config";
import { toRuntimeProviderId } from "@reviewrouter/features-review-providers";
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
  parseReviewRunRuntimeSnapshot,
  reviewRunGatewayOwnedIdentity,
  type ManageReviewRunAuthorizations,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBindingPort,
  type ReviewRunRuntimeSnapshot,
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
export type ReviewRunModelRouteCheckoutSelectors = Readonly<{
  transport: Exclude<ReviewModelTransport, "account_gateway">;
  providerIndex: number;
  workflowSchemaVersion: 2;
}>;
type ModelRouteAuthority = Readonly<{
  authorization: ReviewRunAuthorization;
  snapshot: ReviewRunRuntimeSnapshot;
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

/** Uses the existing read-only SCM checkout and frozen runtime configuration.
 * Subscription/OAuth credentials stay with their qualified runner adapter. */
export function createReviewRunModelRouteCheckout(
  input: CheckoutDependencies & {
    readonly confirmHostedRoute?: (
      input: ModelRouteAuthority,
    ) => Promise<boolean>;
  },
) {
  return createReviewRunCheckout({ ...input, modelTransport: "model_route" });
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
      | {
          readonly modelTransport: "model_route";
          readonly confirmHostedRoute?: (
            input: ModelRouteAuthority,
          ) => Promise<boolean>;
        }
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
      selectors:
        | CheckoutSelectors
        | ProviderApiCheckoutSelectors
        | ReviewRunModelRouteCheckoutSelectors,
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
      if (
        !canonical ||
        !snapshot ||
        (input.modelTransport === "account_gateway"
          ? !snapshot.gateway?.limits ||
            snapshot.deadline !== auth.maxExpiresAt.toISOString()
          : snapshot.gateway !== null ||
            (input.modelTransport === "provider_api"
              ? snapshot.agent.agentKind !== "codex" &&
                !(
                  snapshot.agent.agentKind === "ocr" &&
                  snapshot.modelDispatchCapability?.transport ===
                    "runner_local_responses" &&
                  snapshot.modelDispatchCapability.wireProtocol ===
                    "openai-responses" &&
                  snapshot.modelDispatchCapability.outputTokenLimit ===
                    "upstream_request"
                )
              : (snapshot.agent.agentKind !== "ocr" &&
                  !(
                    snapshot.agent.agentKind === "codex" &&
                    snapshot.modelDispatchCapability?.wireProtocol ===
                      "codex-responses" &&
                    snapshot.modelDispatchCapability.outputTokenLimit ===
                      "terminal_acceptance" &&
                    (snapshot.modelDispatchCapability.transport ===
                      "runner_local_responses" ||
                      snapshot.modelDispatchCapability.transport ===
                        "hosted_pool")
                  )) ||
                !snapshot.modelDispatchCapability ||
                snapshot.modelDispatchCapability.transport ===
                  "account_gateway") ||
            !snapshot.agent.modelTransports.includes("provider_api") ||
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
      let executionAuthorizationEpoch: number | undefined;
      let modelSettings:
        | Awaited<ReturnType<ReadSelectedGatewayModelSettings>>
        | undefined;
      const configuration =
        directConfiguration ??
        parseReviewConfigurationStrict(
          JSON.parse(snapshot.configurationCanonicalJson),
        );
      const modelRoute =
        input.modelTransport === "model_route"
          ? snapshot.modelDispatchCapability
          : undefined;
      const provider =
        configuration.providers[
          modelRoute?.providerIndex ?? snapshot.gateway?.providerIndex ?? 0
        ];
      if (
        (input.modelTransport === "account_gateway" &&
          (provider?.authMode !== "codex_account_gateway" ||
            provider.gatewayBindingId !== snapshot.gateway!.bindingId ||
            provider.gatewayProfileRef !== snapshot.gateway!.profileRef ||
            configuration.providers.find((entry) => entry.kind === "codex") !==
              provider)) ||
        (modelRoute &&
          (configuration.providers.length !== 1 ||
            !provider ||
            provider.model !==
              (modelRoute.configuredModel ?? modelRoute.model) ||
            reviewModelTransportForAuthMode(provider.authMode) !==
              modelRoute.transport)) ||
        canonicalJson(configuration) !== snapshot.configurationCanonicalJson
      )
        throw new CheckoutFailure("checkout_unavailable", 403);
      const liveBinding = async () => {
        if (
          input.modelTransport === "model_route" &&
          modelRoute?.transport === "hosted_pool"
        ) {
          if (
            !input.confirmHostedRoute ||
            !(await checked(() =>
              input.confirmHostedRoute!({ authorization: auth, snapshot }),
            ))
          )
            throw new CheckoutFailure("authorization_denied", 401);
          return;
        }
        if (input.modelTransport !== "account_gateway") return;
        const result = await checked(() =>
          input.bindings.read({
            authorizationId: auth.authorizationId,
            identity: reviewRunGatewayOwnedIdentity(auth),
            runtimeSnapshotCanonicalJson: canonical,
          }),
        );
        // Nullable attachment is intentional: checkout precedes first inference.
        // The existing reader validates pinned config, original use and any attachment.
        if (
          result.status !== "live" ||
          (modelSettings &&
            result.binding &&
            result.binding.authorizationEpoch !==
              modelSettings.authorizationEpoch)
        )
          throw new CheckoutFailure("authorization_denied", 401);
        executionAuthorizationEpoch = result.binding?.authorizationEpoch;
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
          : input.modelTransport === "provider_api"
            ? !("providerApiAuthMode" in selectors) ||
              selectors.providerApiAuthMode !== directMode ||
              selectors.workflowSchemaVersion !==
                providerApiCheckoutCompanionContract.workflowSchemaVersion
            : !("transport" in selectors) ||
              selectors.transport !== modelRoute?.transport ||
              selectors.providerIndex !== modelRoute?.providerIndex ||
              selectors.workflowSchemaVersion !== 2
      )
        throw new CheckoutFailure("authorization_denied", 401);
      await liveBinding();
      if (
        !(await checked(() => input.confirmAuthority(token, auth, savedTarget)))
      )
        throw new CheckoutFailure("authorization_denied", 401);
      if (
        input.modelTransport === "account_gateway" &&
        snapshot.gateway!.profileRef === codexOAuthModelSettingsProfile
      ) {
        if (!input.readSelectedModelSettings)
          throw new CheckoutFailure("checkout_unavailable", 503);
        modelSettings = await checked(() =>
          input.readSelectedModelSettings!({
            authorization: auth,
            signal,
            ...(executionAuthorizationEpoch === undefined
              ? {}
              : { executionAuthorizationEpoch }),
          }),
        );
        if (
          (snapshot.gateway!.expectedAuthorizationEpoch !== undefined &&
            modelSettings.authorizationEpoch !==
              snapshot.gateway!.expectedAuthorizationEpoch) ||
          (executionAuthorizationEpoch !== undefined &&
            modelSettings.authorizationEpoch !== executionAuthorizationEpoch)
        )
          throw new CheckoutFailure("authorization_denied", 401);
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
      if (modelSettings?.settings !== undefined)
        runtimeEnv[gatewayModelSettingsRuntimeEnvKey] =
          serializeSelectedGatewayModelSettings(
            modelSettings.settings,
            provider!.model,
          );
      if (snapshot.contextToolsPlanCanonicalJson !== undefined) {
        runtimeEnv.REVIEW_ROUTER_CONTEXT_TOOLS_PLAN_JSON =
          snapshot.contextToolsPlanCanonicalJson;
      }
      // Only the admitted agent definition is exported, never today's setting.
      runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON = canonicalJson(
        snapshot.agent,
      );
      runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_DIGEST =
        snapshot.agentProfileDigest;
      if (snapshot.prDescriptionCapability !== undefined) {
        runtimeEnv[prDescriptionContract.capabilityRuntimeEnvKey] =
          canonicalJson(snapshot.prDescriptionCapability);
      }
      if (snapshot.modelDispatchCapability !== undefined) {
        runtimeEnv.REVIEW_ROUTER_MODEL_DISPATCH_CAPABILITY_JSON = canonicalJson(
          snapshot.modelDispatchCapability,
        );
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
        (input.modelTransport === "model_route"
          ? runtimeEnv.REVIEW_AUTH_MODE !== providerRuntimeAuthMode(provider) ||
            runtimeEnv.REVIEW_PROVIDERS !== toRuntimeProviderId(provider)
          : input.modelTransport === "account_gateway"
            ? runtimeEnv.CODEX_MODEL !== provider.model
            : runtimeEnv.REVIEW_AUTH_MODE !== directMode ||
              !directMode ||
              runtimeEnv.REVIEW_PROVIDERS !==
                `${providerApiDescriptors[directMode].runtimePrefix}/${provider.model}`) ||
        (provider.kind === "claude"
          ? runtimeEnv.CLAUDE_MODEL !== provider.model ||
            runtimeEnv.CLAUDE_AGENTIC_CONTEXT !==
              String(provider.agenticContext)
          : runtimeEnv.CODEX_REASONING_EFFORT !== provider.reasoningEffort ||
            runtimeEnv.CODEX_AGENTIC_CONTEXT !==
              String(provider.agenticContext) ||
            runtimeEnv.CODEX_FAST_MODE !== String(provider.fastMode))
      )
        throw new CheckoutFailure("checkout_unavailable", 403);
      checkTime();
      return Object.freeze({
        protocolVersion: 1,
        repository: savedTarget.repositoryFullName,
        headSha: auth.headSha,
        token: readToken,
        expiresAt: new Date(expiry).toISOString(),
        permissions: Object.freeze({ contents: "read", pullRequests: "read" }),
        runtimeConfig: Object.freeze({
          protocolVersion: 1,
          configVersion: snapshot.configurationVersion,
          runtimeEnv: Object.freeze(runtimeEnv),
        }),
      });
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
        : checkout.modelTransport === "model_route"
          ? "/api/action/v2/model-route/checkout"
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
  modelTransport: "account_gateway" | "provider_api" | "model_route",
): {
  token: string;
  selectors:
    | CheckoutSelectors
    | ProviderApiCheckoutSelectors
    | ReviewRunModelRouteCheckoutSelectors;
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
  // Exact scalar members. Decode keys before checking uniqueness so
  // escaped duplicate names cannot disappear through JSON.parse's last-wins rule.
  const jsonString =
    '"(?:[^"\\\\\\x00-\\x1f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const jsonNumber = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?";
  const whitespace = "[ \\t\\r\\n]*";
  const member = `(${jsonString})${whitespace}:${whitespace}(${jsonString}|${jsonNumber})`;
  const memberCount = modelTransport === "model_route" ? 3 : 2;
  const members = new RegExp(
    `^${whitespace}\\{${whitespace}${Array.from({ length: memberCount }, () => member).join(`${whitespace},${whitespace}`)}${whitespace}\\}${whitespace}$`,
  ).exec(request.body.toString("utf8"));
  if (
    !members ||
    new Set(
      Array.from({ length: memberCount }, (_, index) =>
        JSON.parse(members[1 + index * 2]!),
      ),
    ).size !== memberCount
  )
    throw new CheckoutFailure("invalid_request", 400);
  const selectors: unknown = JSON.parse(request.body.toString("utf8"));
  if (modelTransport === "model_route") {
    if (
      typeof selectors !== "object" ||
      !selectors ||
      Object.keys(selectors).sort().join(",") !==
        "providerIndex,transport,workflowSchemaVersion" ||
      !("transport" in selectors) ||
      (selectors.transport !== "runner_local_responses" &&
        selectors.transport !== "runner_local_anthropic" &&
        selectors.transport !== "hosted_pool") ||
      !("providerIndex" in selectors) ||
      !Number.isSafeInteger(selectors.providerIndex) ||
      selectors.providerIndex !== 0 ||
      !("workflowSchemaVersion" in selectors) ||
      selectors.workflowSchemaVersion !== 2
    )
      throw new CheckoutFailure("invalid_request", 400);
    return {
      token: header.slice(7),
      selectors: {
        transport: selectors.transport,
        providerIndex: selectors.providerIndex,
        workflowSchemaVersion: 2,
      },
    };
  }
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
