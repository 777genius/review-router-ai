// Post-deploy check for deployments that give the runtime separate database
// roles. Run it with the DATABASE_URL of the role you want to check, for
// example the worker:
//
//   DATABASE_URL=... node scripts/check-runtime-db-privileges.mjs
//
// CI and local tests run as a superuser, so a missing grant only shows up in
// production, as an event that fails again and again until it is dead lettered.
// Two checks:
//   1. privileges the runtime is known to need, per role name;
//   2. outbox dead letters from the last 7 days that mention "permission denied".
import pg from "pg";

/** Privileges known to be needed by the code that runs under each role. */
export const requiredPrivileges = Object.freeze({
  reviewrouter_worker: [
    // installation.sync_requested upserts repositories.
    { table: "RepositoryConnection", privilege: "INSERT" },
    { table: "RepositoryConnection", privilege: "UPDATE" },
    { sequence: "RepositoryInventoryGeneration", privilege: "USAGE" },
    // The outbox handlers claim, settle and dead-letter events.
    { table: "OutboxEvent", privilege: "UPDATE" },
    // Statistics and history projections.
    { table: "ReviewStatisticsReviewFact", privilege: "INSERT" },
    { table: "ReviewStatisticsIssueFact", privilege: "INSERT" },
  ],
});

/** Pure: turns probe results into the list of problems to print. */
export function describeProblems({ role, missing, permissionDeadLetters }) {
  const problems = [];
  for (const item of missing)
    problems.push(
      `${role} lacks ${item.privilege} on ${item.table ?? item.sequence}`,
    );
  for (const row of permissionDeadLetters)
    problems.push(
      `${row.count} dead-lettered ${row.type} event(s) failed with a permission error, latest ${row.latest}`,
    );
  return problems;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query("select current_user as role");
    const role = rows[0].role;
    const required = requiredPrivileges[role] ?? [];
    const missing = [];
    for (const item of required) {
      const result = item.table
        ? await client.query(
            // True for a table-level grant and for a column-level one, which is how the
            // worker gets INSERT and UPDATE on RepositoryConnection.
            "select has_any_column_privilege(current_user, $1, $2) as ok",
            [`public."${item.table}"`, item.privilege],
          )
        : await client.query(
            "select has_sequence_privilege(current_user, $1, $2) as ok",
            [`public."${item.sequence}"`, item.privilege],
          );
      if (!result.rows[0].ok) missing.push(item);
    }
    const dead = await client
      .query(
        `select type, count(*)::int as count, max("deadLetteredAt")::text as latest
           from "OutboxEvent"
          where status = 'dead_letter'
            and "deadLetteredAt" > now() - interval '7 days'
            and ("safeLastErrorSummary" ilike '%permission denied%'
              or "safeLastErrorSummary" ilike '%42501%')
          group by type
          order by type`,
      )
      .then((r) => r.rows)
      .catch((error) => {
        // The role may not read the outbox at all; say so instead of passing.
        console.warn(`dead letter scan skipped: ${error.message}`);
        return [];
      });
    const problems = describeProblems({
      role,
      missing,
      permissionDeadLetters: dead,
    });
    console.log(
      `role ${role}: checked ${required.length} known privilege(s)${
        required.length === 0
          ? " (no known requirements for this role name)"
          : ""
      }`,
    );
    for (const problem of problems) console.error(`PROBLEM: ${problem}`);
    process.exit(problems.length === 0 ? 0 : 1);
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
