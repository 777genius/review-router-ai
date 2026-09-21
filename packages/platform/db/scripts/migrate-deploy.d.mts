export const MIN_SUPPORTED_POSTGRES_MAJOR: number;

export function postgresMajor(serverVersionNum: unknown): number;

export function assertSupportedPostgresVersion(
  serverVersionNum: unknown,
): number;

export interface MigrateDeployOptions {
  readonly databaseUrl?: string;
  readonly inspectVersion?: (databaseUrl: string) => Promise<unknown>;
  readonly runMigration?: () => Promise<void>;
}

export function migrateDeploy(options?: MigrateDeployOptions): Promise<void>;
