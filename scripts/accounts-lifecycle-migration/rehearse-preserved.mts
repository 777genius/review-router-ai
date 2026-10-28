import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Finite TEST fixture operator, never an ambient DATABASE_URL or arbitrary SQL.
const container = "rr-accounts-reference-pg-20261019";
const database = "rr_gateway_test_c2c_accounts";
const migration = readFileSync(
  new URL(
    "../../packages/platform/db/prisma/migrations/000134_account_lifecycle/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const migrationSha256 = createHash("sha256").update(migration).digest("hex");
assert.equal(process.env.RR_ACCOUNT_LIFECYCLE_POPULATED_TEST, "1");
assert.equal(
  process.env.RR_ACCOUNT_LIFECYCLE_QUALIFIED_SHA256,
  migrationSha256,
  "qualify these exact migration bytes first",
);
const output = process.env.RR_ACCOUNT_LIFECYCLE_REHEARSAL_RECEIPT;
assert.equal(typeof output, "string");
assert.ok(output);
assert.ok(
  output.startsWith("/srv/workers/adhoc/iliya/admin-ux-canary-20261019/"),
);
assert.ok(output.includes("/tmp/"));
function psql(sql: string): string {
  const result = spawnSync(
    "sudo",
    [
      "-n",
      "docker",
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "--no-password",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-U",
      "fixture_owner",
      "-d",
      database,
    ],
    {
      input: sql,
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
const operationColumns = [
  "id",
  "actorUserId",
  "clientOperationId",
  "action",
  "personalWorkspaceId",
  "proposedSourceId",
  "sourceId",
  "targetWorkspaceId",
  "profileId",
  "displayName",
  "ingress",
  "normalizedIntentHash",
  "expectedSourceMetadataRevision",
  "expectedGatewayRevision",
  "expectedAuthorizationEpoch",
  "predecessorBindingId",
  "expectedPredecessorRevision",
  "bindingId",
  "expectedBindingRevision",
  "resultSourceId",
  "resultBindingId",
  "phase",
  "createdAt",
  "updatedAt",
];
const select = (table: string, expression = "to_jsonb(t)") =>
  `SELECT COALESCE(jsonb_agg(${expression} ORDER BY t."id"),'[]'::jsonb) FROM "${table}" t`;
function snapshot() {
  return Object.fromEntries(
    [
      "User",
      "Workspace",
      "ProviderAccountConnection",
      "WorkspaceAccountBinding",
      "PersonalAccountOperation",
    ].map((table) => {
      const expression =
        table === "PersonalAccountOperation"
          ? `jsonb_build_object(${operationColumns.map((column) => `'${column}',t."${column}"`).join(",")})`
          : "to_jsonb(t)";
      return [table, JSON.parse(psql(select(table, expression))) as unknown[]];
    }),
  );
}
const before = snapshot();
assert.equal(before.User!.length, 3);
assert.equal(before.ProviderAccountConnection!.length, 3);
assert.equal(before.PersonalAccountOperation!.length, 10);
const receipt = {
  fixture: { container, database },
  migrationSha256,
  source: fileURLToPath(import.meta.url),
  before,
  after: null as typeof before | null,
  exactRowsPreserved: false,
  applied: false,
};
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
psql(migration);
receipt.applied = true;
receipt.after = snapshot();
assert.deepEqual(
  receipt.after,
  before,
  "every preexisting row and field must remain identical",
);
receipt.exactRowsPreserved = true;
writeFileSync(output, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
console.log(
  JSON.stringify({
    migrationSha256,
    exactRowsPreserved: true,
    users: 3,
    sources: 3,
    operations: 10,
  }),
);
