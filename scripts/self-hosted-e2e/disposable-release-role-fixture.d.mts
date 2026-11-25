export const disposableBefore87: "000087_codex_oauth_v4_v5_workflow_reattestation";

export function writeDisposableMigrationCatalog(
  phase: "before87" | "pre79" | "through79",
  parent?: string,
): string;

export const disposableFreshDatabasePreflightSql: string;
export const disposableBefore87HandoffSql: string;
export const disposableFullChainVerificationSql: string;
export const disposableProvider79HandoffSql: string;
export const disposableProvider79VerificationSql: string;
export const disposableReleasePairPreflightSql: string;

export function disposableRuntimeIdentityVerificationSql(
  phase: "full111" | "provider79",
): string;

export function disposableRuntimeQualifiedVerificationSql(
  phase: "full111" | "provider79",
): string;

export function disposableReleaseMigrationRoleSql(password: string): string;

export function disposableReleaseMigrationRoleCleanupSql(
  oid: string | number | bigint,
): string;
