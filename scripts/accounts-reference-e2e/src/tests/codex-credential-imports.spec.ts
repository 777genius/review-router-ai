import { expect, test, type APIRequestContext } from "@playwright/test";
import { FIXTURES } from "../contracts.ts";
import { withDatabase } from "../database.ts";
import {
  chooseSetupOption as choose,
  expectNoHorizontalOverflow,
} from "./provider-setup-support.ts";
import {
  captureSecretLeaks,
  connectionsListRegion,
  expectNetworkViolations,
  installLoopbackOnlyNetworkGuard,
  noSecrets,
  openAccounts,
  reloadAccounts,
  sourceRow,
  useViewerSession,
} from "./support.ts";

test.skip(
  process.env.ACCOUNTS_REFERENCE_E2E_ACCOUNT_MODELS !== "1" ||
    process.env.ACCOUNTS_REFERENCE_E2E_SUBSCRIPTIONS !== "1",
  "Requires the existing controlled account-models and subscription Gateway fixture.",
);

type ImportProof = {
  action: "connect" | "reconnect";
  method: "refresh_token" | "oauth_auth_json";
  operationRef: string;
  accountRef: string;
  metadataRevision: number;
  authorizationEpoch: number;
};
async function fixture(request: APIRequestContext, importsEnabled?: boolean) {
  const url = `${process.env.ACCOUNTS_REFERENCE_E2E_GATEWAY_URL}/__account-models-fixture`;
  const response =
    importsEnabled === undefined
      ? await request.get(url)
      : await request.post(url, { data: { importsEnabled } });
  expect(response.ok()).toBe(true);
  return (await response.json()) as {
    importsEnabled: boolean;
    imports: ImportProof[];
  };
}
async function storedConnection(label: string) {
  return withDatabase(
    process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
    async (db) => {
      const result = await db.query<{
        id: string;
        gatewayAccountRef: string;
        profileRef: string;
        state: string;
        metadataRevision: number;
        authorizationEpochMirror: string;
        pendingSourceOperationId: string | null;
      }>(
        `SELECT id,"gatewayAccountRef","profileRef",state,"metadataRevision",
          "authorizationEpochMirror"::text,"pendingSourceOperationId"
         FROM "ProviderAccountConnection"
         WHERE "ownerUserId"=$1 AND "displayName"=$2`,
        [FIXTURES.users.viewer, label],
      );
      expect(result.rows).toHaveLength(1);
      return result.rows[0]!;
    },
  );
}

for (const method of ["refresh_token", "oauth_auth_json"] as const) {
  test(
    method === "refresh_token"
      ? "Codex import refresh_token submits and reconnects through real server actions"
      : "Codex import oauth_auth_json submits through real server actions",
    async ({ page, context, request }, info) => {
      test.setTimeout(180_000);
      const credential =
        method === "refresh_token"
          ? "synthetic-codex-refresh-token"
          : '{"tokens":{"refresh_token":"synthetic-codex-auth-json"}}';
      const reconnectCredential = "synthetic-codex-reconnect-refresh-token";
      const secrets = [
        credential,
        "synthetic-codex-auth-json",
        reconnectCredential,
      ];
      const leaks = captureSecretLeaks(page, secrets);
      const violations: string[] = [];
      await installLoopbackOnlyNetworkGuard(page, violations);
      await useViewerSession(context);
      await page.setViewportSize(
        method === "oauth_auth_json"
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
      );
      const before = await fixture(request, true);
      expect(before.importsEnabled).toBe(true);
      const label = `Browser Codex ${method}`;
      const fieldLabel =
        method === "refresh_token" ? "Refresh token" : "Codex auth.json";
      try {
        await openAccounts(page, FIXTURES.workspaces.personalViewer);
        await connectionsListRegion(page)
          .getByRole("button", { name: "Connect account", exact: true })
          .click();
        const dialog = page.getByRole("dialog", { name: "Connect a provider" });
        await choose(page, "Provider", "Codex");
        await choose(page, "Connection method", `Import ${fieldLabel}`);
        await dialog.getByLabel("Connection name", { exact: true }).fill(label);
        const field = dialog.getByLabel(fieldLabel, { exact: true });
        await field.fill(credential);
        await expect(field).toHaveValue(credential);
        await dialog
          .getByRole("button", { name: "Connect Codex", exact: true })
          .click();

        const row = sourceRow(page, label);
        await expect(row).toBeVisible();
        await expect(row).toContainText("Ready");
        await expect(row).toContainText("imported-codex@example.invalid");
        await expect(row).toContainText("Subscription ends 2026-12-31");
        await noSecrets(page, secrets);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: info.outputPath(`codex-${method}-created.png`),
          fullPage: true,
        });
        const created = await storedConnection(label);
        expect(created).toMatchObject({
          profileRef: "openai-codex-oauth-responses-v1",
          state: "active",
          authorizationEpochMirror: "1",
          pendingSourceOperationId: null,
        });
        const createdProofs = (await fixture(request)).imports.slice(
          before.imports.length,
        );
        expect(createdProofs).toEqual([
          {
            action: "connect",
            method,
            operationRef: expect.any(String),
            accountRef: created.gatewayAccountRef,
            metadataRevision: 1,
            authorizationEpoch: 1,
          },
        ]);

        // A new document must read the same durable RR source; the fixture is
        // only the authenticated Gateway transport, never a browser response.
        await leaks.drain();
        await reloadAccounts(page);
        await expect(sourceRow(page, label)).toContainText(
          "imported-codex@example.invalid",
        );
        if (method === "refresh_token") {
          await sourceRow(page, label)
            .getByRole("button", { name: `Actions for ${label}` })
            .click();
          await page
            .getByRole("menuitem", { name: "Reconnect", exact: true })
            .click();
          const reconnect = page.getByRole("dialog", {
            name: "Reconnect Codex",
            exact: true,
          });
          await expect(reconnect).toContainText(label);
          await choose(page, "Connection method", "Import Refresh token");
          await reconnect
            .getByLabel("Refresh token", { exact: true })
            .fill(reconnectCredential);
          await reconnect
            .getByRole("button", { name: "Reconnect Codex", exact: true })
            .click();
          await expect(reconnect).toHaveCount(0);
          await expect(sourceRow(page, label)).toContainText("Ready");
          await expect
            .poll(async () => (await fixture(request)).imports.length)
            .toBe(before.imports.length + 2);
          await leaks.drain();
          await reloadAccounts(page);
          const updated = await storedConnection(label);
          expect(updated).toMatchObject({
            id: created.id,
            gatewayAccountRef: created.gatewayAccountRef,
            profileRef: created.profileRef,
            state: "active",
            authorizationEpochMirror: "2",
            pendingSourceOperationId: null,
          });
          expect(updated.metadataRevision).toBeGreaterThan(
            created.metadataRevision,
          );
          const proofs = (await fixture(request)).imports.slice(
            before.imports.length,
          );
          expect(proofs).toHaveLength(2);
          expect(proofs[1]).toEqual({
            action: "reconnect",
            method,
            operationRef: expect.any(String),
            accountRef: created.gatewayAccountRef,
            metadataRevision: 2,
            authorizationEpoch: 2,
          });
          expect(proofs[1]!.operationRef).not.toBe(proofs[0]!.operationRef);
          await expect(sourceRow(page, label)).toHaveCount(1);
          await expect(sourceRow(page, label)).toContainText(
            "imported-codex@example.invalid",
          );
          await page.screenshot({
            path: info.outputPath("codex-refresh-token-reconnected.png"),
            fullPage: true,
          });
        }
        const operations = await withDatabase(
          process.env.ACCOUNTS_REFERENCE_E2E_TEST_DATABASE_URL!,
          async (db) =>
            (
              await db.query<{
                action: string;
                phase: string;
                credentialImportMethod: string | null;
                nativeConnection: {
                  schemaVersion: number;
                  profileId: string;
                  methodId: string;
                  methodRevision: number;
                  configurationGeneration: string;
                } | null;
              }>(
                `SELECT action,phase,"credentialImportMethod","nativeConnection" FROM "PersonalAccountOperation"
               WHERE "actorUserId"=$1 AND ("sourceId"=$2 OR "resultSourceId"=$2)
               ORDER BY "createdAt",id`,
                [FIXTURES.users.viewer, created.id],
              )
            ).rows,
        );
        expect(operations).toEqual(
          (method === "refresh_token"
            ? ["connect", "reconnect"]
            : ["connect"]
          ).map((action) => ({
            action,
            phase: "applied",
            credentialImportMethod: null,
            nativeConnection: {
              schemaVersion: 1,
              profileId: "openai-codex-oauth-responses-v1",
              methodId: method,
              methodRevision: 1,
              configurationGeneration: "visual-native-generation-1",
            },
          })),
        );
        await noSecrets(page, secrets);
        await leaks.verify();
        await expectNetworkViolations(violations);
      } finally {
        expect((await fixture(request, false)).importsEnabled).toBe(false);
      }
    },
  );
}
