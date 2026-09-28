import type { PrismaClient } from "@prisma/client";

export class HostedHistoricalScopeDeniedError extends Error {
  constructor(readonly cause: unknown) {
    super("hosted_historical_scope_denied");
  }
}

/** The env opt-in is generation-local; the DB policy is destination-local. */
export class PrismaHostedHistoricalScopeBarrier {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly destination: {
      readonly required: boolean;
      readonly resourceIdentity: string;
      readonly incarnation: string;
    },
  ) {}

  private async assertConfigured(): Promise<boolean> {
    // This read tolerates an absent projection when disabled. The full grant
    // repository and effect ledger still require migration 000110 first.
    // The qualified catalog name rejects a caller's shadow projection.
    const catalog = await this.prisma.$queryRaw<Array<{ installed: boolean }>>`
      SELECT pg_catalog.to_regclass('public."HostedHistoricalScopePolicy"') IS NOT NULL AS "installed"
    `;
    if (catalog[0]?.installed !== true) {
      if (!this.destination.required) return false;
      throw new HostedHistoricalScopeDeniedError("hosted_historical_policy_schema_missing");
    }
    const rows = await this.prisma.$queryRaw<
      Array<{ databaseResourceIdentity: string; databaseIncarnation: string }>
    >`
      SELECT "databaseResourceIdentity", "databaseIncarnation"
      FROM public."HostedHistoricalScopePolicy" WHERE "id" = 'global'
    `;
    const policy = rows[0];
    if (!this.destination.required && !policy) return false;
    if (
      !this.destination.required ||
      !policy ||
      policy.databaseResourceIdentity !== this.destination.resourceIdentity ||
      policy.databaseIncarnation !== this.destination.incarnation
    ) {
      throw new HostedHistoricalScopeDeniedError(
        "hosted_historical_destination_policy_mismatch",
      );
    }
    const ready = await this.prisma.$queryRaw<Array<{ ready: boolean }>>`
      SELECT public.hosted_historical_assert_ready() AS "ready"
    `;
    if (ready[0]?.ready !== true) {
      throw new HostedHistoricalScopeDeniedError("hosted_historical_marker_not_ready");
    }
    return true;
  }

  async assertAdmissionAllowed(input: {
    readonly workspaceId: string;
    readonly repositoryConnectionId: string;
    readonly reviewRequestId: string;
    readonly grantId: string;
    readonly invocationId: string;
    readonly providerInvocationKey: string;
    readonly runId: string;
  }): Promise<void> {
    try {
      if (!(await this.assertConfigured())) return;
      const rows = await this.prisma.$queryRaw<Array<{ denied: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM public."ReviewRequestedIntent" i
          JOIN public."RepositoryConnection" r
            ON r."id" = i."repositoryConnectionId"
          JOIN public."HostedHistoricalUnknownScope" s
            ON s."githubRepositoryId" = r."githubRepositoryId"
           AND s."pullRequestNumber" = i."pullRequestNumber"
           AND s."headSha" = i."headSha"
           AND s."providerFamily" = 'codex_subscription_oauth_hosted_pool'
          WHERE i."requestId" = ${input.reviewRequestId}
            AND i."workspaceId" = ${input.workspaceId}
            AND i."repositoryConnectionId" = ${input.repositoryConnectionId}
            AND i."scmRepositoryIdentityId" = r."scmRepositoryIdentityId"
            AND i."admissionState" = 'admitted' AND r."provider" = 'github'
            AND r."githubRepositoryId" > 0 AND i."pullRequestNumber" > 0
            AND i."headSha" ~ '^[a-f0-9]{40}$'
        ) OR EXISTS (
          SELECT 1 FROM public."HostedHistoricalScopeAlias" a
          WHERE (a."kind" = 'grant' AND a."value" = ${input.grantId})
             OR (a."kind" = 'invocation' AND a."value" = ${input.invocationId})
             OR (a."kind" = 'review_request' AND a."value" = ${input.reviewRequestId})
             OR (a."kind" = 'provider_invocation' AND a."value" = ${input.providerInvocationKey})
             OR (a."kind" = 'run' AND a."value" = ${input.runId})
        ) AS "denied"
      `;
      const trusted = await this.prisma.$queryRaw<Array<{ found: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM public."ReviewRequestedIntent" i
          JOIN public."RepositoryConnection" r ON r."id" = i."repositoryConnectionId"
          WHERE i."requestId" = ${input.reviewRequestId}
            AND i."workspaceId" = ${input.workspaceId}
            AND i."repositoryConnectionId" = ${input.repositoryConnectionId}
            AND i."scmRepositoryIdentityId" = r."scmRepositoryIdentityId"
            AND i."admissionState" = 'admitted' AND r."provider" = 'github'
            AND r."githubRepositoryId" > 0 AND i."pullRequestNumber" > 0
            AND i."headSha" ~ '^[a-f0-9]{40}$'
        ) AS "found"
      `;
      if (!trusted[0]?.found || rows[0]?.denied !== false) {
        throw new Error("hosted_historical_trusted_scope_missing_or_denied");
      }
    } catch (error) {
      if (error instanceof HostedHistoricalScopeDeniedError) throw error;
      throw new HostedHistoricalScopeDeniedError(error);
    }
  }

  async assertGrantAllowed(grantId: string): Promise<void> {
    try {
      if (!(await this.assertConfigured())) return;
      const rows = await this.prisma.$queryRaw<Array<{ allowed: boolean }>>`
        SELECT public.hosted_historical_assert_grant(g) AS "allowed"
        FROM public."HostedCodexInvocationGrant" g WHERE g."id" = ${grantId}
      `;
      if (rows.length !== 1 || rows[0]?.allowed !== true) {
        throw new Error("hosted_historical_grant_missing_or_denied");
      }
    } catch (error) {
      if (error instanceof HostedHistoricalScopeDeniedError) throw error;
      throw new HostedHistoricalScopeDeniedError(error);
    }
  }
}
