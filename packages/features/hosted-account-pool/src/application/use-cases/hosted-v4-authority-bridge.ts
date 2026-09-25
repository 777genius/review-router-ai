import { createHmac, timingSafeEqual } from "node:crypto";

/** A server-held SCM adapter may request only these GitHub App permissions. */
export const hostedV4ScmReadPermissions = Object.freeze({
  contents: "read",
  pull_requests: "read",
} as const);

export type HostedV4Authorization = Readonly<{
  authorizationId: string;
  workspaceId: string;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  pullRequestNumber: number;
  baseSha: string;
  mergeBaseSha: string;
  headSha: string;
  reviewRevisionHash: string;
  mutationEpoch: bigint;
  producerReleaseId: string;
  trustDomain: string;
  investigationCodexRecordingAllowed: boolean;
  state: string;
  expiresAt: Date;
}>;

export type HostedV4LiveAuthority = Readonly<{
  workspaceId: string;
  repositoryConnectionId: string;
  scmRepositoryIdentityId: string;
  githubRepositoryId: string;
  githubInstallationId: string;
  owner: string;
  repo: string;
  providerInstanceId: string;
  bindingId: string;
  bindingVersion: number;
  bindingActive: boolean;
  poolActive: boolean;
  selected: boolean;
  installationActive: boolean;
  pullRequestNumber: number;
  headSha: string;
  reviewRevisionHash: string;
  producerReleaseId: string;
  producerReleaseRegistered: boolean;
}>;

export interface HostedV4AuthoritySources {
  /** Must use the existing review_run_authorize token verifier and current record. */
  resolveAuthorizationToken(
    token: string,
  ): Promise<HostedV4Authorization | null>;
  /** Must read the current record, including revocation and expiry. */
  findAuthorization(id: string): Promise<HostedV4Authorization | null>;
  /** Must resolve current binding, exact head/revision and producer release. */
  readLiveAuthority(
    authorization: HostedV4Authorization,
  ): Promise<HostedV4LiveAuthority | null>;
}

export type HostedV4ReadScope = Readonly<{
  authorizationId: string;
  repositoryConnectionId: string;
  githubRepositoryId: string;
  githubInstallationId: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  providerInstanceId: string;
  bindingId: string;
  bindingVersion: number;
  headSha: string;
  reviewRevisionHash: string;
  producerReleaseId: string;
  expiresAt: string;
}>;

type SignedScope = HostedV4ReadScope & { readonly version: 1 };

/**
 * Server-only bridge. The signed capability is for the SCM read gateway;
 * it is never a GitHub bearer and cannot be used with relay or comment routes.
 * Each use and refresh checks live authority, so a moved head or revoked run
 * closes an already issued capability without a new persistence table.
 */
export class HostedV4AuthorityBridge {
  constructor(
    private readonly sources: HostedV4AuthoritySources,
    private readonly signingKey: Uint8Array,
    private readonly now: () => Date,
    private readonly ttlMs = 5 * 60_000,
  ) {
    if (
      signingKey.length < 32 ||
      !Number.isInteger(ttlMs) ||
      ttlMs < 1_000 ||
      ttlMs > 10 * 60_000
    ) {
      throw new Error("hosted_v4_bridge_configuration_invalid");
    }
  }

  async admit(input: {
    readonly authorizationToken: string;
    readonly repositoryConnectionId: string;
    readonly providerInstanceId: string;
    readonly bindingId: string;
    readonly bindingVersion: number;
  }): Promise<{
    readonly capability: string;
    readonly scope: HostedV4ReadScope;
  }> {
    if (
      !input.authorizationToken ||
      !input.repositoryConnectionId ||
      !input.bindingId ||
      !Number.isSafeInteger(input.bindingVersion) ||
      input.bindingVersion < 1
    ) {
      throw denied();
    }
    const authorization = await this.sources.resolveAuthorizationToken(
      input.authorizationToken,
    );
    if (
      !authorization ||
      authorization.repositoryConnectionId !== input.repositoryConnectionId
    )
      throw denied();
    const live = await this.check(authorization);
    if (
      live.providerInstanceId !== input.providerInstanceId ||
      live.bindingId !== input.bindingId ||
      live.bindingVersion !== input.bindingVersion
    )
      throw denied();
    return this.issue(authorization, live);
  }

  /** Resolve relay prerequisites from the v2 token and current server state.
   * This returns no signed SCM capability and cannot issue a relay grant.
   */
  async resolveRelayAuthority(input: {
    readonly authorizationToken: string;
    readonly repositoryConnectionId: string;
    readonly providerInstanceId: string;
    readonly bindingId: string;
    readonly bindingVersion: number;
  }): Promise<
    Readonly<{
      authorization: HostedV4Authorization;
      live: HostedV4LiveAuthority;
    }>
  > {
    if (
      !input.authorizationToken ||
      !input.repositoryConnectionId ||
      !input.bindingId ||
      !Number.isSafeInteger(input.bindingVersion) ||
      input.bindingVersion < 1
    )
      throw denied();
    const authorization = await this.sources.resolveAuthorizationToken(
      input.authorizationToken,
    );
    if (
      !authorization ||
      authorization.repositoryConnectionId !== input.repositoryConnectionId
    )
      throw denied();
    const live = await this.check(authorization);
    if (
      live.providerInstanceId !== input.providerInstanceId ||
      live.bindingId !== input.bindingId ||
      live.bindingVersion !== input.bindingVersion
    )
      throw denied();
    return { authorization, live };
  }

  async resolveRead(capability: string): Promise<HostedV4ReadScope> {
    const scope = this.verify(capability);
    await this.checkSignedScope(scope);
    return scope;
  }

  async refresh(
    capability: string,
    authorizationToken: string,
  ): Promise<{
    readonly capability: string;
    readonly scope: HostedV4ReadScope;
  }> {
    const scope = this.verify(capability);
    if (!authorizationToken) throw denied();
    const renewedAuthorization =
      await this.sources.resolveAuthorizationToken(authorizationToken);
    if (
      !renewedAuthorization ||
      renewedAuthorization.authorizationId !== scope.authorizationId
    )
      throw denied();
    const { authorization, live } = await this.checkSignedScope(scope);
    return this.issue(authorization, live);
  }

  private async checkSignedScope(scope: SignedScope) {
    const authorization = await this.sources.findAuthorization(
      scope.authorizationId,
    );
    if (
      !authorization ||
      authorization.authorizationId !== scope.authorizationId
    )
      throw denied();
    const live = await this.check(authorization);
    if (
      scope.repositoryConnectionId !== live.repositoryConnectionId ||
      scope.githubRepositoryId !== live.githubRepositoryId ||
      scope.githubInstallationId !== live.githubInstallationId ||
      scope.owner !== live.owner ||
      scope.repo !== live.repo ||
      scope.pullRequestNumber !== live.pullRequestNumber ||
      scope.providerInstanceId !== live.providerInstanceId ||
      scope.bindingId !== live.bindingId ||
      scope.bindingVersion !== live.bindingVersion ||
      scope.headSha !== live.headSha ||
      scope.reviewRevisionHash !== live.reviewRevisionHash ||
      scope.producerReleaseId !== live.producerReleaseId ||
      new Date(scope.expiresAt) <= this.now() ||
      authorization.expiresAt <= this.now()
    )
      throw denied();
    return { authorization, live };
  }

  private async check(
    authorization: HostedV4Authorization,
  ): Promise<HostedV4LiveAuthority> {
    if (
      authorization.state !== "active" ||
      authorization.expiresAt <= this.now() ||
      authorization.trustDomain !== "trusted_managed" ||
      !authorization.investigationCodexRecordingAllowed
    )
      throw denied();
    const live = await this.sources.readLiveAuthority(authorization);
    // The live lookup can await GitHub and release resolution. Re-read the
    // authorization after it returns so a concurrent revocation cannot issue
    // or resolve a capability from the earlier snapshot.
    const current = await this.sources.findAuthorization(
      authorization.authorizationId,
    );
    if (
      !current ||
      current.authorizationId !== authorization.authorizationId ||
      current.workspaceId !== authorization.workspaceId ||
      current.repositoryConnectionId !== authorization.repositoryConnectionId ||
      current.scmRepositoryIdentityId !==
        authorization.scmRepositoryIdentityId ||
      current.pullRequestNumber !== authorization.pullRequestNumber ||
      current.baseSha !== authorization.baseSha ||
      current.mergeBaseSha !== authorization.mergeBaseSha ||
      current.headSha !== authorization.headSha ||
      current.reviewRevisionHash !== authorization.reviewRevisionHash ||
      current.mutationEpoch !== authorization.mutationEpoch ||
      current.producerReleaseId !== authorization.producerReleaseId ||
      current.trustDomain !== authorization.trustDomain ||
      current.investigationCodexRecordingAllowed !==
        authorization.investigationCodexRecordingAllowed ||
      current.state !== "active" ||
      current.expiresAt.getTime() !== authorization.expiresAt.getTime() ||
      current.expiresAt <= this.now() ||
      !live ||
      !live.bindingActive ||
      !live.poolActive ||
      !live.selected ||
      !live.installationActive ||
      !live.producerReleaseRegistered ||
      live.workspaceId !== authorization.workspaceId ||
      live.repositoryConnectionId !== authorization.repositoryConnectionId ||
      live.scmRepositoryIdentityId !== authorization.scmRepositoryIdentityId ||
      live.pullRequestNumber !== authorization.pullRequestNumber ||
      live.headSha !== authorization.headSha ||
      live.reviewRevisionHash !== authorization.reviewRevisionHash ||
      live.producerReleaseId !== authorization.producerReleaseId ||
      live.providerInstanceId !==
        `hosted-pool:repository:${live.githubRepositoryId}` ||
      !live.owner ||
      !live.repo
    )
      throw denied();
    return live;
  }

  private issue(
    authorization: HostedV4Authorization,
    live: HostedV4LiveAuthority,
  ) {
    const expiresAt = new Date(
      Math.min(
        authorization.expiresAt.getTime(),
        this.now().getTime() + this.ttlMs,
      ),
    );
    if (expiresAt <= this.now()) throw denied();
    const scope: SignedScope = {
      version: 1,
      authorizationId: authorization.authorizationId,
      repositoryConnectionId: live.repositoryConnectionId,
      githubRepositoryId: live.githubRepositoryId,
      githubInstallationId: live.githubInstallationId,
      owner: live.owner,
      repo: live.repo,
      pullRequestNumber: live.pullRequestNumber,
      providerInstanceId: live.providerInstanceId,
      bindingId: live.bindingId,
      bindingVersion: live.bindingVersion,
      headSha: live.headSha,
      reviewRevisionHash: live.reviewRevisionHash,
      producerReleaseId: live.producerReleaseId,
      expiresAt: expiresAt.toISOString(),
    };
    const payload = Buffer.from(JSON.stringify(scope), "utf8").toString(
      "base64url",
    );
    const signature = this.sign(payload);
    return { capability: `${payload}.${signature}`, scope };
  }

  private verify(capability: string): SignedScope {
    if (typeof capability !== "string" || capability.length > 4_096)
      throw denied();
    const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/u.exec(capability);
    if (!match) throw denied();
    const actual = Buffer.from(match[2]!, "base64url");
    const expected = Buffer.from(this.sign(match[1]!), "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw denied();
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
    } catch {
      throw denied();
    }
    if (!isSignedScope(parsed) || new Date(parsed.expiresAt) <= this.now())
      throw denied();
    return parsed;
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.signingKey)
      .update("hosted-v4-scm-read-v1\0")
      .update(payload)
      .digest("base64url");
  }
}

function isSignedScope(value: unknown): value is SignedScope {
  if (!isRecord(value)) return false;
  const keys = [
    "version",
    "authorizationId",
    "repositoryConnectionId",
    "githubRepositoryId",
    "githubInstallationId",
    "owner",
    "repo",
    "pullRequestNumber",
    "providerInstanceId",
    "bindingId",
    "bindingVersion",
    "headSha",
    "reviewRevisionHash",
    "producerReleaseId",
    "expiresAt",
  ];
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value) &&
    value.version === 1 &&
    typeof value.bindingVersion === "number" &&
    Number.isSafeInteger(value.bindingVersion) &&
    value.bindingVersion > 0 &&
    typeof value.pullRequestNumber === "number" &&
    Number.isSafeInteger(value.pullRequestNumber) &&
    value.pullRequestNumber > 0 &&
    keys
      .filter(
        (key) =>
          key !== "version" &&
          key !== "bindingVersion" &&
          key !== "pullRequestNumber",
      )
      .every(
        (key) =>
          typeof value[key] === "string" && (value[key] as string).length > 0,
      ) &&
    Number.isFinite(Date.parse(value.expiresAt as string))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function denied(): Error {
  return new Error("hosted_v4_authority_denied");
}
