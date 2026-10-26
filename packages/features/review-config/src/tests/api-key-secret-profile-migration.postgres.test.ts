import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";

const databaseUrl = process.env.REVIEW_ROUTER_KEY_STORAGE_TEST_DATABASE_URL;

it.skipIf(!databaseUrl)(
  "incrementally admits direct repository secrets while preserving custody and immutable identity",
  async () => {
    const url = new URL(databaseUrl!);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/reviewrouter_key_storage_backend_test" ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("dedicated_loopback_key_storage_test_database_required");
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const workspaceId = `key-storage-${randomUUID()}`;
    const rowId = `${workspaceId}-mimo`;
    try {
      const previous = await readFile(
        new URL(
          "../../../../platform/db/prisma/migrations/000145_workspace_provider_profiles/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      const start = previous.indexOf(
        'CONSTRAINT "WorkspaceProviderProfile_auth_mode" CHECK (',
      );
      const end = previous.indexOf("    -- Exactly the reference", start);
      const check = previous.slice(start, end).trim().replace(/,$/, "");
      await client.query(
        'ALTER TABLE "WorkspaceProviderProfile" DROP CONSTRAINT "WorkspaceProviderProfile_auth_mode"',
      );
      await client.query(`ALTER TABLE "WorkspaceProviderProfile" ADD ${check}`);
      await client.query(
        'INSERT INTO "Workspace" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())',
        [workspaceId],
      );
      const insert = async (
        id: string,
        authMode: string,
        kind = "user_ci_secret",
      ) =>
        client.query(
          'INSERT INTO "WorkspaceProviderProfile" (id,"workspaceId","credentialKind","authMode",model,label,"identityKey","updatedAt") VALUES ($1,$2,$3::"ProviderCredentialKind",$4,$5,$1,$1,now())',
          [
            id,
            workspaceId,
            kind,
            authMode,
            authMode === "kimi_code_api_key" ? "k3-256k" : "fixture-model",
          ],
        );
      await insert(rowId, "mimo_token_plan_api_key");
      await expect(
        insert(`${workspaceId}-old-or`, "openrouter_api_key"),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "WorkspaceProviderProfile_auth_mode",
      });
      const before = (
        await client.query(
          'SELECT * FROM "WorkspaceProviderProfile" WHERE id=$1',
          [rowId],
        )
      ).rows[0];
      const migration = await readFile(
        new URL(
          "../../../../platform/db/prisma/migrations/000149_api_key_repository_secret_profiles/migration.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await client.query(migration);
      await insert(`${workspaceId}-or`, "openrouter_api_key");
      await insert(`${workspaceId}-kimi`, "kimi_code_api_key");
      expect(
        (
          await client.query(
            'SELECT * FROM "WorkspaceProviderProfile" WHERE id=$1',
            [rowId],
          )
        ).rows[0],
      ).toEqual(before);
      await expect(
        insert(
          `${workspaceId}-managed-kimi`,
          "kimi_code_api_key",
          "managed_api_key",
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "WorkspaceProviderProfile_auth_mode",
      });
      await expect(
        client.query(
          'UPDATE "WorkspaceProviderProfile" SET "authMode"=$1 WHERE id=$2',
          ["openrouter_api_key", rowId],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        message: "workspace_provider_profile_credential_immutable",
      });
      const rows = await client.query(
        'SELECT "credentialKind", "authMode", "apiKeyConnectionId", "gatewayBindingId" FROM "WorkspaceProviderProfile" WHERE "workspaceId"=$1 ORDER BY "authMode"',
        [workspaceId],
      );
      expect(rows.rows).toEqual(
        [
          "kimi_code_api_key",
          "mimo_token_plan_api_key",
          "openrouter_api_key",
        ].map((authMode) => ({
          credentialKind: "user_ci_secret",
          authMode,
          apiKeyConnectionId: null,
          gatewayBindingId: null,
        })),
      );
    } finally {
      await client.query('DELETE FROM "Workspace" WHERE id=$1', [workspaceId]);
      await client.end();
    }
  },
);
