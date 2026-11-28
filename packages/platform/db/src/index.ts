import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export { resolveCodexOAuthDatabaseEffectAuthorityUrl } from "./codex-oauth-database-effect-authority.js";
export { resolveCommentTokenCustodyDatabaseAuthorityUrl } from "./comment-token-custody-database-authority.js";
export {
  isDatabaseAcquisitionTimeout,
  isDatabaseUnavailable,
} from "./database-availability.js";
export {
  PostgresTransactionClock,
  type PostgresTransactionClockClient,
  type TransactionClock,
} from "./postgres-transaction-clock.js";

export type DatabaseHealth = {
  readonly connected: boolean;
  readonly checkedAt: Date;
};

export function createDatabaseHealth(
  connected: boolean,
  checkedAt = new Date(),
): DatabaseHealth {
  return { connected, checkedAt };
}

export type CreatePrismaClientOptions = {
  readonly databaseUrl?: string;
  readonly poolMax?: number;
  /** Finite wait for pool acquisition and establishing a new connection. */
  readonly poolConnectionTimeoutMs?: number;
  /** Retire authenticated backends even while periodically active. */
  readonly poolMaxLifetimeSeconds?: number;
  readonly transactionMaxWaitMs?: number;
  readonly transactionTimeoutMs?: number;
  /** Server-side limits for runtime SQL; administrative clients opt out. */
  readonly executionBudget?: DatabaseExecutionBudget;
};

export type DatabaseExecutionBudget = {
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
};

/** Runtime statements terminate on the server, releasing their pool slot. */
export const runtimeDatabaseExecutionBudget = {
  statementTimeoutMs: 30_000,
  lockTimeoutMs: 5_000,
} as const satisfies DatabaseExecutionBudget;

export function createPrismaClient(
  options: CreatePrismaClientOptions = {},
): PrismaClient {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to create PrismaClient");
  }
  const poolMax =
    options.poolMax ??
    parseOptionalPositiveInteger("REVIEW_ROUTER_DB_POOL_MAX");
  const connectionTimeoutMillis =
    options.poolConnectionTimeoutMs ??
    parseOptionalPositiveInteger(
      "REVIEW_ROUTER_DB_POOL_CONNECTION_TIMEOUT_MS",
    ) ??
    5000;
  if (
    !Number.isSafeInteger(connectionTimeoutMillis) ||
    connectionTimeoutMillis < 1
  )
    throw new Error("poolConnectionTimeoutMs must be a positive integer");
  // adapter-pg normalizes timestamptz text assuming UTC. Enforce that session
  // contract even when a caller supplies PostgreSQL startup options in the URL.
  const connectionUrl = new URL(databaseUrl);
  const startupOptions = connectionUrl.searchParams.get("options") ?? "";
  connectionUrl.searchParams.delete("options");
  const executionOptions = options.executionBudget
    ? executionBudgetStartupOptions(options.executionBudget)
    : "";
  const adapterConfig = {
    connectionString: connectionUrl.toString(),
    connectionTimeoutMillis,
    // Later PostgreSQL startup options win. A URL cannot disable the runtime
    // budget; transaction owners can still use a reviewed SET LOCAL budget.
    options: `${startupOptions} -c timezone=UTC${executionOptions}`,
    ...(typeof poolMax === "number" ? { max: poolMax } : {}),
    ...(typeof options.poolMaxLifetimeSeconds === "number"
      ? { maxLifetimeSeconds: options.poolMaxLifetimeSeconds }
      : {}),
  };

  return new PrismaClient({
    adapter: new PrismaPg(adapterConfig),
    transactionOptions: {
      ...(typeof options.transactionMaxWaitMs === "number"
        ? { maxWait: options.transactionMaxWaitMs }
        : {}),
      ...(typeof options.transactionTimeoutMs === "number"
        ? { timeout: options.transactionTimeoutMs }
        : {}),
    },
  });
}

function executionBudgetStartupOptions(
  budget: DatabaseExecutionBudget,
): string {
  for (const name of ["statementTimeoutMs", "lockTimeoutMs"] as const) {
    const value = budget[name];
    // PostgreSQL timeout settings are positive signed 32-bit milliseconds.
    if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(
        `executionBudget.${name} must be a positive PostgreSQL integer`,
      );
    }
  }
  return ` -c statement_timeout=${budget.statementTimeoutMs} -c lock_timeout=${budget.lockTimeoutMs}`;
}

function parseOptionalPositiveInteger(name: string): number | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export { PrismaClient };

export {
  acquireCurrentScopeGuards,
  CURRENT_SCOPE_GUARD_NAMESPACE,
  type CurrentScopeGuard,
} from "./current-scope-guards.js";
export {
  rotateRemovedScmRepositoryIdentityEpoch,
  rotateScmRepositoryIdentityEpoch,
} from "./scm-repository-identity-epoch.js";
