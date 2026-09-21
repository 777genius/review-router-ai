import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import {
  buildActionOidcReplayNonceKey,
  resolveActionOidcReplayNonceExpiresAt,
  type ActionControlPlaneRepositoryPort,
  type ActionOidcReplayNonceStorePort,
  type GitHubActionsOidcClaims,
  type GitHubActionsOidcTokenVerifierPort,
} from "@reviewrouter/features-action-control-plane";
import {
  AuthorityError,
  type AuthenticatedEfExecution,
  type EfAuthorityService,
} from "@reviewrouter/features-sdk-growth-authority";

// Admission and completion envelopes carry base64 for every bounded binary
// field. 48 MiB admits the codec's aggregate maxima plus JSON/base64 overhead
// while keeping transport input explicitly bounded.
export const SDK_GROWTH_AUTHORITY_BODY_LIMIT = 48 * 1024 * 1024;

export interface ResolvedSdkGrowthExecution {
  readonly installationId: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly verifierRevision: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
}

export interface SdkGrowthExecutionResolverPort {
  /** Resolve from the provider API/installation custody, never from request JSON. */
  resolve(input: {
    readonly installationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly runId: string;
    readonly runAttempt: string;
    readonly verifierRevision: string;
  }): Promise<ResolvedSdkGrowthExecution | null>;
}

export interface SdkGrowthRequestAuthenticationPort {
  authenticate(
    request: FastifyRequest,
    route: { readonly repositoryId: string; readonly pullRequest: number },
  ): Promise<AuthenticatedEfExecution>;
}

export class SdkGrowthOidcAuthentication implements SdkGrowthRequestAuthenticationPort {
  constructor(
    private readonly verifier: GitHubActionsOidcTokenVerifierPort,
    private readonly repositories: ActionControlPlaneRepositoryPort,
    private readonly replayNonces: ActionOidcReplayNonceStorePort,
    private readonly executions: SdkGrowthExecutionResolverPort,
    private readonly audience: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!audience.trim()) throw new Error("sdk_growth_oidc_audience_required");
  }

  async authenticate(
    request: FastifyRequest,
    route: { readonly repositoryId: string; readonly pullRequest: number },
  ): Promise<AuthenticatedEfExecution> {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384)
      throw new AuthorityError("wrong-identity");
    const token = authorization.slice("Bearer ".length);
    if (!token || /\s/.test(token)) throw new AuthorityError("wrong-identity");
    const claims = await this.verifier
      .verify({
        token,
        audience: this.audience,
      })
      .catch((error: unknown) => {
        // A verified token with malformed required claims is a credential failure.
        if (error instanceof ZodError) throw new AuthenticationFailure();
        throw error;
      });
    const repository = await this.repositories.findSelectedRepositoryByGithubId(
      claims.repository_id,
    );
    if (
      !repository ||
      !repository.selected ||
      repository.installationStatus !== "active" ||
      repository.repositoryId !== route.repositoryId ||
      repository.githubRepositoryId !== claims.repository_id ||
      repository.fullName.toLowerCase() !== claims.repository.toLowerCase()
    )
      throw new AuthorityError("wrong-identity");
    const claimRevision = verifierRevision(claims);
    const resolved = await this.executions.resolve({
      installationId: repository.githubInstallationId,
      githubRepositoryId: repository.githubRepositoryId,
      repositoryFullName: repository.fullName,
      runId: claims.run_id,
      runAttempt: claims.run_attempt,
      verifierRevision: claimRevision,
    });
    if (
      !resolved ||
      resolved.installationId !== repository.githubInstallationId ||
      resolved.runId !== claims.run_id ||
      resolved.runAttempt !== claims.run_attempt ||
      resolved.verifierRevision !== claimRevision
    )
      throw new AuthorityError("wrong-identity");
    const consumed = await this.replayNonces.tryConsumeNonce({
      key: buildActionOidcReplayNonceKey(claims),
      expiresAt: resolveActionOidcReplayNonceExpiresAt({
        claims,
        now: this.now(),
      }),
      now: this.now(),
    });
    if (!consumed) throw new AuthorityError("wrong-identity");
    return {
      tenantId: repository.workspaceId,
      repositoryId: repository.repositoryId,
      pullRequest: route.pullRequest,
      githubRepositoryId: repository.githubRepositoryId,
      installationId: resolved.installationId,
      subject: claims.sub,
      runId: resolved.runId,
      runAttempt: resolved.runAttempt,
      verifierRevision: resolved.verifierRevision,
      sourceCommit: lowerCommit(resolved.sourceCommit),
      sourceTree: lowerCommit(resolved.sourceTree),
    };
  }
}

function verifierRevision(claims: GitHubActionsOidcClaims): string {
  const revision = claims.job_workflow_sha ?? claims.workflow_sha;
  if (!revision || !/^[a-fA-F0-9]{40}$/.test(revision))
    throw new AuthorityError("wrong-identity");
  return revision.toLowerCase();
}

function lowerCommit(value: string): string {
  if (!/^[a-fA-F0-9]{40}$/.test(value))
    throw new AuthorityError("invalid-contract");
  return value.toLowerCase();
}

interface RouteParams {
  repositoryId: string;
  pullRequest: string;
  requestDigest?: string;
}

interface CompletionQuery {
  requestDigest?: string;
  completionDigest?: string;
}

export interface RegisterSdkGrowthAuthorityRoutesDependencies {
  readonly authentication: SdkGrowthRequestAuthenticationPort;
  readonly service: EfAuthorityService;
}

function scope(request: FastifyRequest<{ Params: RouteParams }>) {
  const repositoryId = request.params.repositoryId;
  const pullRequestText = request.params.pullRequest;
  const pullRequest = Number(pullRequestText);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/.test(repositoryId) ||
    !/^[1-9][0-9]*$/.test(pullRequestText) ||
    !Number.isSafeInteger(pullRequest) ||
    pullRequest < 1
  )
    throw new AuthorityError("invalid-contract");
  return { repositoryId, pullRequest };
}

function digestParameter(value: string | undefined): string {
  if (!value || !/^sha256:[a-f0-9]{64}$/.test(value))
    throw new AuthorityError("invalid-contract");
  return value;
}

function sendWire(
  reply: {
    header(name: string, value: string): unknown;
    send(value: Buffer): unknown;
  },
  value: Uint8Array,
) {
  reply.header("content-type", "application/octet-stream");
  reply.header("cache-control", "no-store");
  return reply.send(Buffer.from(value));
}

class AuthenticationFailure extends Error {}

async function authenticate(
  authentication: SdkGrowthRequestAuthenticationPort,
  request: FastifyRequest,
  route: { repositoryId: string; pullRequest: number },
): Promise<AuthenticatedEfExecution> {
  try {
    return await authentication.authenticate(request, route);
  } catch (error) {
    if (
      error instanceof AuthorityError ||
      error instanceof AuthenticationFailure
    )
      throw error;
    // Credential failures are distinct from repository, nonce-store, provider,
    // and JWKS availability failures during authentication.
    const code = (error as { code?: unknown } | null)?.code;
    if (
      [
        "ERR_JWT_EXPIRED",
        "ERR_JWT_CLAIM_VALIDATION_FAILED",
        "ERR_JWT_INVALID",
        "ERR_JWS_INVALID",
        "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
        "ERR_JOSE_ALG_NOT_ALLOWED",
      ].includes(String(code))
    )
      throw new AuthenticationFailure();
    throw error;
  }
}

function status(error: unknown): number {
  if (error instanceof AuthenticationFailure) return 401;
  if (!(error instanceof AuthorityError)) return 503;
  if (error.code === "not-found") return 404;
  if (error.code === "conflict" || error.code === "fenced") return 409;
  if (error.code === "invalid-contract") return 400;
  if (error.code === "io-timeout") return 503;
  return 403;
}

async function handled<T>(
  reply: { code(value: number): { send(value: unknown): unknown } },
  operation: (serviceStarted: () => void) => Promise<T>,
  mutation = false,
): Promise<T | undefined> {
  let serviceStarted = false;
  try {
    return await operation(() => {
      serviceStarted = true;
    });
  } catch (error) {
    const statusCode = status(error);
    reply.code(statusCode).send({
      error:
        error instanceof AuthorityError
          ? error.code
          : error instanceof AuthenticationFailure
            ? "authentication-failed"
            : "service-failed",
      ...(statusCode === 503
        ? { retryable: true, uncertain: mutation && serviceStarted }
        : {}),
    });
    return undefined;
  }
}

export async function registerSdkGrowthAuthorityRoutes(
  app: FastifyInstance,
  dependencies: RegisterSdkGrowthAuthorityRoutesDependencies,
): Promise<void> {
  const base = "/sdk-growth/v1/repositories/:repositoryId/pulls/:pullRequest";
  app.post<{ Params: RouteParams }>(
    `${base}/requests`,
    { bodyLimit: SDK_GROWTH_AUTHORITY_BODY_LIMIT },
    async (request, reply) => {
      const value = await handled(
        reply,
        async (serviceStarted) => {
          const route = scope(request);
          const execution = await authenticate(
            dependencies.authentication,
            request,
            route,
          );
          serviceStarted();
          return dependencies.service.admit(
            execution,
            route.repositoryId,
            route.pullRequest,
            request.body,
          );
        },
        true,
      );
      if (value) return sendWire(reply, value);
    },
  );
  app.get<{ Params: RouteParams }>(
    `${base}/requests/:requestDigest`,
    async (request, reply) => {
      const value = await handled(reply, async (serviceStarted) => {
        const route = scope(request);
        const requestDigest = digestParameter(request.params.requestDigest);
        const execution = await authenticate(
          dependencies.authentication,
          request,
          route,
        );
        serviceStarted();
        return dependencies.service.admissionReadback(
          execution,
          route.repositoryId,
          route.pullRequest,
          requestDigest,
        );
      });
      if (value === null) return reply.code(404).send({ error: "not-found" });
      if (value) return sendWire(reply, value);
    },
  );
  app.post<{ Params: RouteParams }>(
    `${base}/completions`,
    { bodyLimit: SDK_GROWTH_AUTHORITY_BODY_LIMIT },
    async (request, reply) => {
      const value = await handled(
        reply,
        async (serviceStarted) => {
          const route = scope(request);
          const execution = await authenticate(
            dependencies.authentication,
            request,
            route,
          );
          serviceStarted();
          return dependencies.service.complete(
            execution,
            route.repositoryId,
            route.pullRequest,
            request.body,
          );
        },
        true,
      );
      if (value) return sendWire(reply, value);
    },
  );
  app.get<{ Params: RouteParams; Querystring: CompletionQuery }>(
    `${base}/receipts`,
    async (request, reply) => {
      const value = await handled(reply, async (serviceStarted) => {
        const route = scope(request);
        const requestDigest = digestParameter(request.query.requestDigest);
        const completionDigest = digestParameter(
          request.query.completionDigest,
        );
        const execution = await authenticate(
          dependencies.authentication,
          request,
          route,
        );
        serviceStarted();
        return dependencies.service.completionReadback(
          execution,
          route.repositoryId,
          route.pullRequest,
          requestDigest,
          completionDigest,
        );
      });
      if (value === null) return reply.code(404).send({ error: "not-found" });
      if (value) return sendWire(reply, value);
    },
  );
  app.get<{ Params: RouteParams; Querystring: { requestDigest?: string } }>(
    `${base}/status`,
    async (request, reply) => {
      const value = await handled(reply, async (serviceStarted) => {
        const route = scope(request);
        const requestDigest = digestParameter(request.query.requestDigest);
        const execution = await authenticate(
          dependencies.authentication,
          request,
          route,
        );
        serviceStarted();
        return dependencies.service.status(
          execution,
          route.repositoryId,
          route.pullRequest,
          requestDigest,
        );
      });
      if (value === null) return reply.code(404).send({ error: "not-found" });
      if (value)
        return reply.send({
          requestDigest: value.requestDigest,
          grantDigest: value.grantDigest,
          completionDigest: value.completionDigest,
          receiptDigest: value.receiptDigest,
          publicationState: value.publicationState,
          authorityState: value.authorityState,
        });
    },
  );
}
