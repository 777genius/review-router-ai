import { buildSelfHostedDatabasePlan } from "../../deploy/self-hosted/install-database.ts";

type SqlResult = Readonly<{ status: number | null; output: string }>;
type ExecuteSql = (
  sql: string,
  label: string,
  allowFailure?: boolean,
) => SqlResult;

/** Exercise the production guard against the disposable PostgreSQL catalog. */
export function verifyDatabaseRoleConfigurationGuard(
  environment: Readonly<Record<string, string | undefined>>,
  execute: ExecuteSql,
): void {
  // Building the production plan validates the interpolated database identifier.
  const { preMigrationSql } = buildSelfHostedDatabasePlan(environment);
  execute(preMigrationSql, "authority_settings_baseline");
  const role = "reviewrouter_codex_effect_authority";
  const scopes = [
    ["global", ""],
    ["current_database", ` IN DATABASE ${environment.POSTGRES_DB}`],
    ["other_database", " IN DATABASE postgres"],
  ] as const;
  for (const [name, clause] of scopes) {
    execute(
      `ALTER ROLE ${role}${clause} SET statement_timeout = '12345ms';\n`,
      `authority_settings_${name}_set`,
    );
    try {
      const result = execute(
        preMigrationSql,
        `authority_settings_${name}_reject`,
        true,
      );
      if (
        result.status !== 3 ||
        !/^ERROR:\s+self_hosted_database_authority_role_invalid\s*$/mu.test(
          result.output,
        )
      ) {
        throw new Error(`authority_settings_${name}_rejection_unproved`);
      }
    } finally {
      execute(
        `ALTER ROLE ${role}${clause} RESET statement_timeout;\n`,
        `authority_settings_${name}_reset`,
      );
    }
    execute(preMigrationSql, `authority_settings_${name}_restored`);
  }
}
