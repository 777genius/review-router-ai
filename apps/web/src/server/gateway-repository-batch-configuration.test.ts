// @vitest-environment jsdom
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createManagementClient } from "@agent-teams/account-gateway/http";
import { assertWorkspaceAdminAllowed, PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import { assertWorkspaceFeatureEntitlement, freeBetaEntitlement, freeBetaLimits, PrismaEntitlementRepository } from "@reviewrouter/features-entitlements";
import { createDashboardRateLimitPolicy } from "./dashboard-rate-limits";
import {
  findReviewConfiguration,
  PrismaReviewConfigurationRepository,
  safeDefaultReviewConfiguration,
  saveReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  GatewayRepositoryBatchControls,
  GatewayRepositoryBatchTargetToggle,
  type GatewayBatchInventoryItem,
} from "../../app/dashboard/gateway-repository-batch-controls";
import type { AccountsResult, AccountsPage } from "./account-gateway-accounts";
import {
  createGatewayRepositoryBatchAdapter,
  assertGatewayBatchRepositoryEligible,
  GatewayBatchDenied,
  type GatewayBatchRequest,
  type GatewayBatchResult,
} from "./gateway-repository-batch-configuration";

// Plausible failures: batch code overwrites a concurrent single-editor save,
// saves a transferred repo under stale ownership, resets selection on refresh,
// reports partial success as green, or resubmits after a lost response.
// Reusing a scoped nonce with a changed selection/version must not mislabel the
// original receipt as applied to that changed intent, including during recovery.
// Refetching a new profile on the same binding must not silently change the
// user's chosen provider profile even when its model is still eligible.
// Empty inventory must retain the unknown operation and selection while disabling
// saves. Genuine entitlement/rate refusals must allow finishing the results.
// A repository still selected locally may be archived/disabled or replaced at
// the App-scoped endpoint; missing endpoint facts must remain unknown.
// One test crosses the real C1 + P111 Prisma/PostgreSQL boundary and drives the
// visible React/Radix UI. No mocked configuration repository/receipt/auth use case.
// Primary supplies its approved existing disposable loopback fixture with P120.
// This worker never starts this fixture, migrates or reads ambient runtime auth.
test.skipIf(process.env.RR_P114_BATCH_TEST !== "1")(
  "gateway batch preserves CAS, live target scope, selection and exact receipt recovery",
  async () => {
    expect(process.env.RR_P114_BATCH_NEW_DISPOSABLE_CLUSTER).toBe("1");
    const url = new URL(process.env.RR_P114_BATCH_TEST_URL ?? "");
    if (!/^\/rr_gateway_test_p114_[a-f0-9]{32}$/.test(url.pathname) ||
      url.hostname !== "127.0.0.1" || !["postgres:", "postgresql:"].includes(url.protocol) ||
      !/^[a-zA-Z0-9_]+$/.test(url.username) || !url.port || url.password || url.search || url.hash)
      throw new Error("new_p114_disposable_loopback_fixture_required");
    const db = new PrismaClient({ adapter: new PrismaPg({
      host: "127.0.0.1", port: Number(url.port), user: url.username, database: url.pathname.slice(1),
      password: () => process.env.PGPASSWORD ?? "", ssl: false, max: 6, options: "-c search_path=public", client_encoding: "UTF8",
    }) });
    const repositoryFacts = new Map<string, Record<string, unknown>>();
    let catalogUnavailable = false;
    const server = createServer((request, response) => {
      const facts = repositoryFacts.get(request.url ?? "");
      if (request.method === "GET" && facts && request.headers.authorization === "Bearer fixture-only") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(facts)); return;
      }
      if (request.method !== "GET" || request.url !== "/v1/profiles" || request.headers.authorization !== "Bearer fixture-only") {
        response.writeHead(404).end(); return;
      }
      if (catalogUnavailable) { response.writeHead(503).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
        profiles: ["fixture-responses", "fixture-alternate"].map((profileId) => ({
          profileId, protocol: "openai-responses", authKinds: ["api_key"], modelIds: ["fixture-model"],
        })),
      }));
    });
    let fixtureStarted = false;
    try {
      // A populated fixture is a failure, never silently reused by another test.
      expect(await db.workspace.count()).toBe(0);
      expect(await db.user.count()).toBe(0);
      expect(await db.repositoryConnection.count()).toBe(0);
      expect(await db.providerAccountConnection.count()).toBe(0);
      expect(await db.reviewConfiguration.count()).toBe(0);
      server.listen(0, "127.0.0.1");
      await once(server, "listening"); fixtureStarted = true;
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture_listener_required");
      const gateway = createManagementClient({ role: "management", origin: `http://127.0.0.1:${address.port}`, token: "fixture-only", timeoutMs: 2000, responseBytes: 65536 });
      const workspaceId = "fixture-workspace";
      const foreignWorkspace = "fixture-foreign-workspace";
      const actor = { userId: "fixture-user", githubUserId: "", githubLogin: "synthetic" };
      await db.workspace.createMany({ data: [workspaceId, foreignWorkspace].map((id) => ({ id, slug: id, name: id })) });
      await db.user.create({ data: { id: actor.userId } });
      await db.workspaceMember.create({ data: { workspaceId, userId: actor.userId, role: "admin" } });
      await db.gitHubInstallation.createMany({ data: [workspaceId, foreignWorkspace].map((id, index) => ({
        id: `${id}-installation`, workspaceId: id, githubInstallationId: BigInt(index + 1),
        accountLogin: id, accountType: "Organization", repositorySelection: "all", status: "active",
      })) });
      const ids = ["fixture-applied", "fixture-conflict", "fixture-denied"] as const;
      for (const [index, id] of ids.entries()) repositoryFacts.set(`/fixture/repositories/${id}`, {
        id: index + 10, full_name: `fixture/${id}`, archived: false, disabled: false,
      });
      await db.repositoryConnection.createMany({ data: ids.map((id, index) => ({
        id, workspaceId, installationId: `${workspaceId}-installation`, githubRepositoryId: BigInt(index + 10),
        externalRepositoryId: String(index + 10), owner: "fixture", name: id, fullName: `fixture/${id}`,
        defaultBranch: "main", visibility: "private", selected: true, archived: false,
      })) });
      await db.providerAccountConnection.create({ data: {
        id: "fixture-connection", ownerWorkspaceId: workspaceId, gatewayAccountRef: "fixture-account",
        profileRef: "fixture-responses", displayName: "Fixture account", state: "active",
      } });
      await db.workspaceAccountBinding.create({ data: {
        id: "fixture-binding", workspaceId, connectionId: "fixture-connection", state: "active", revision: 1, policyRevision: 1,
      } });
      const configurations = new PrismaReviewConfigurationRepository(db);
      const workspaceConfig = {
        ...safeDefaultReviewConfiguration,
        blockingPolicy: { failOnSeverity: "major" as const },
        limits: { inlineMaxComments: 17, targetTokensPerBatch: 16000 },
        reviewLanguage: "French",
      };
      await saveReviewConfiguration({ target: { scope: "workspace", workspaceId }, config: workspaceConfig }, { configurations });
      const target = (repositoryId: string) => ({ scope: "repository" as const, workspaceId, repositoryId });
      const access = new PrismaWorkspaceAccessRepository(db);
      const entitlements = new PrismaEntitlementRepository(db);
      const ratePolicy = createDashboardRateLimitPolicy(db);
      let pauseEntitlementAfterProfiles = false;
      const adapter = createGatewayRepositoryBatchAdapter({
        configurations,
        bindings: { accounts: new PrismaProviderAccountRepository(db), workspaceAccess: access },
        async authorize(workspace, repositoryId, mode) {
          await assertWorkspaceAdminAllowed({ workspaceId: workspace, ...actor }, { workspaceAccess: access });
          const repository = await db.repositoryConnection.findUnique({ where: { id: repositoryId } });
          if (!repository || repository.workspaceId !== workspace || !repository.selected || repository.archived) throw new GatewayBatchDenied();
          if (mode !== "read") {
            await assertWorkspaceFeatureEntitlement({ workspaceId: workspace, actor: "fixture", feature: "action_control_plane" }, { entitlements });
            if (mode === "save") await ratePolicy.assertReviewConfigSaveAllowed({ workspaceId: workspace, resourceId: repositoryId });
          }
          if (mode === "write") {
            if (!repository.githubRepositoryId) throw new GatewayBatchDenied();
            // Controlled HTTP exercises the production parser/eligibility guard;
            // this is NOT proof of actual GitHub freshness or App authorization.
            await assertGatewayBatchRepositoryEligible({ ...repository, githubRepositoryId: repository.githubRepositoryId }, {
              async request() {
                const response = await fetch(`http://127.0.0.1:${address.port}/fixture/repositories/${repositoryId}`, {
                  headers: { authorization: "Bearer fixture-only" },
                });
                if (!response.ok) throw new Error("fixture_repository_unavailable");
                return { data: await response.json() };
              },
            });
          }
          return actor;
        },
        async profiles() {
          const catalogue = await gateway.profiles();
          if (pauseEntitlementAfterProfiles)
            await entitlements.upsertWorkspaceEntitlement({ ...freeBetaEntitlement(workspaceId), status: "paused" });
          return catalogue.profiles.map((profile) => ({ id: profile.profileId, label: profile.profileId, protocol: profile.protocol, models: [...profile.modelIds] }));
        },
      });
      const accounts: AccountsResult<AccountsPage> = { status: "ok", value: {
        accounts: [{ connectionId: "fixture-connection", label: "Fixture account", profileId: "fixture-responses", profileLabel: "Fixture responses",
          state: "active", gatewayRevision: 1, mirrorRevision: 1, binding: { id: "fixture-binding", revision: 1, state: "active", fencePending: false } }],
        profiles: ["fixture-responses", "fixture-alternate"].map((id) => ({ id, label: id, protocol: "openai-responses", models: ["fixture-model"] })), nextCursor: null,
      } };
      let inventory: readonly GatewayBatchInventoryItem[] = ids.map((repositoryId) => ({ repositoryId, fullName: `fixture/${repositoryId}`, eligible: true, expectedVersion: null }));
      const savedRequests: GatewayBatchRequest[] = [];
      const readRequests: GatewayBatchRequest[] = [];
      let loseResponse = false;
      let loseRead = false;
      let response: GatewayBatchResult | undefined;
      const actions = {
        async save(request: GatewayBatchRequest) {
          savedRequests.push(request);
          response = await adapter.save(request);
          if (loseResponse) throw new Error("fixture_response_lost");
          return response;
        },
        async read(request: GatewayBatchRequest) {
          readRequests.push(request);
          if (loseRead) throw new Error("fixture_read_lost");
          return adapter.read(request);
        },
      };
      const children = ids.map((repositoryId) => createElement(GatewayRepositoryBatchTargetToggle, { key: repositoryId, repositoryId }));
      let currentAccounts = accounts;
      let enabled = true;
      let refreshes = 0;
      const element = () => createElement(GatewayRepositoryBatchControls, {
        workspaceId, inventory, accounts: currentAccounts, enabled, actions,
        refresh: () => { refreshes++; }, children,
      });
      const view = render(element());
      for (const id of ids) fireEvent.click(screen.getByLabelText(`Select fixture/${id} for gateway configuration`));
      async function choose(label: string, option: string) {
        fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "Enter" });
        fireEvent.click(await screen.findByRole("option", { name: option }));
      }
      // Radix scrolls highlighted options; jsdom has no scrolling layout.
      const originalScroll = HTMLElement.prototype.scrollIntoView;
      HTMLElement.prototype.scrollIntoView = () => {};
      try {
        await choose("Gateway account", "Fixture account · Fixture responses");
        await choose("Gateway model", "fixture-model");
        const initialInventory = inventory;
        inventory = []; enabled = false;
        view.rerender(element());
        expect(screen.getByText("3 repositories selected")).toBeTruthy();
        expect((screen.getByRole("button", { name: "Apply gateway configuration" }) as HTMLButtonElement).disabled).toBe(true);
        expect(savedRequests).toHaveLength(0);
        inventory = initialInventory; enabled = true;
        view.rerender(element());
        for (const id of ids) expect((screen.getByLabelText(`Select fixture/${id} for gateway configuration`) as HTMLInputElement).checked).toBe(true);
        // Real typed refusal paths, with no configuration/receipt writes.
        await entitlements.upsertWorkspaceEntitlement({ ...freeBetaEntitlement(workspaceId), status: "paused" });
        fireEvent.click(screen.getByRole("button", { name: "Apply gateway configuration" }));
        await waitFor(() => expect(refreshes).toBe(1));
        for (const id of ids) expect(screen.getByText(`fixture/${id}: denied`)).toBeTruthy();
        expect(await db.reviewConfigurationVersion.count({ where: { configuration: { repositoryId: { in: [...ids] } } } })).toBe(0);
        expect(screen.queryByRole("button", { name: "Check saved operation" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Finish viewing results" }));
        await entitlements.upsertWorkspaceEntitlement(freeBetaEntitlement(workspaceId));
        for (const id of ids) for (let i = 0; i < freeBetaLimits.reviewConfigSavesPerWorkspacePerHour; i++)
          await ratePolicy.assertReviewConfigSaveAllowed({ workspaceId, resourceId: id });
        fireEvent.click(screen.getByRole("button", { name: "Apply gateway configuration" }));
        await waitFor(() => expect(refreshes).toBe(2));
        for (const id of ids) expect(screen.getByText(`fixture/${id}: denied`)).toBeTruthy();
        expect(await findReviewConfiguration(target(ids[0]), { configurations })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Finish viewing results" }));
        await db.rateLimitBucket.deleteMany({ where: { key: { in: ids.map((id) => `dashboard:review_config_save:${workspaceId}:${id}`) } } });
        const eligibilityRequest: GatewayBatchRequest = {
          workspaceId, operationId: randomUUID(), targets: [{ repositoryId: ids[0], expectedVersion: null }],
          selection: { kind: "codex", authMode: "codex_account_gateway", gatewayBindingId: "fixture-binding",
            gatewayProfileRef: "fixture-responses", model: "fixture-model", reasoningEffort: "high", agenticContext: true, fastMode: false, requiredHealthy: true },
        };
        const factsPath = `/fixture/repositories/${ids[0]}`;
        const eligibleFacts = repositoryFacts.get(factsPath)!;
        // Entitlement can change after initial save authorization and catalogue
        // reads; the fresh per-target check must still refuse before mutation.
        pauseEntitlementAfterProfiles = true;
        expect((await adapter.save({ ...eligibilityRequest, operationId: randomUUID() })).results).toEqual([{ repositoryId: ids[0], status: "denied" }]);
        expect(await findReviewConfiguration(target(ids[0]), { configurations })).toBeNull();
        pauseEntitlementAfterProfiles = false;
        await entitlements.upsertWorkspaceEntitlement(freeBetaEntitlement(workspaceId));
        for (const facts of [{ ...eligibleFacts, archived: true }, { ...eligibleFacts, disabled: true }, { ...eligibleFacts, id: 999 }]) {
          repositoryFacts.set(factsPath, facts);
          expect((await adapter.save({ ...eligibilityRequest, operationId: randomUUID() })).results).toEqual([{ repositoryId: ids[0], status: "denied" }]);
          expect(await findReviewConfiguration(target(ids[0]), { configurations })).toBeNull();
        }
        repositoryFacts.set(factsPath, { id: 10, full_name: `fixture/${ids[0]}` });
        expect((await adapter.save(eligibilityRequest)).results).toEqual([{ repositoryId: ids[0], status: "unknown" }]);
        expect((await adapter.read(eligibilityRequest)).results).toEqual([{ repositoryId: ids[0], status: "unknown" }]);
        repositoryFacts.set(factsPath, eligibleFacts);
        catalogUnavailable = true;
        expect((await adapter.save({ ...eligibilityRequest, operationId: randomUUID() })).results).toEqual([{ repositoryId: ids[0], status: "unknown" }]);
        catalogUnavailable = false;
        expect(await findReviewConfiguration(target(ids[0]), { configurations })).toBeNull();
        savedRequests.length = 0; refreshes = 0;
        const changedProfile = await db.providerAccountConnection.update({
          where: { id: "fixture-connection" }, data: { profileRef: "fixture-alternate", metadataRevision: { increment: 1 } },
        });
        currentAccounts = { status: "ok", value: { ...accounts.value, accounts: accounts.value.accounts.map((item) => ({
          ...item, profileId: changedProfile.profileRef!, profileLabel: "Alternate responses", mirrorRevision: changedProfile.metadataRevision,
        })) } };
        view.rerender(element());
        expect(screen.getByText("3 repositories selected")).toBeTruthy();
        expect(screen.getByText("The chosen account or model is no longer eligible. Your repository selection is preserved.")).toBeTruthy();
        expect((screen.getByRole("button", { name: "Apply gateway configuration" }) as HTMLButtonElement).disabled).toBe(true);
        expect(savedRequests).toHaveLength(0);
        await db.providerAccountConnection.update({ where: { id: "fixture-connection" }, data: { profileRef: "fixture-responses", metadataRevision: { increment: 1 } } });
        currentAccounts = accounts;
        view.rerender(element());
        // Concurrent individual-editor save + transfer happen after first paint.
        const concurrent = await saveReviewConfiguration({ target: target(ids[1]), config: { ...workspaceConfig, reviewLanguage: "German" }, expectedVersion: null }, { configurations });
        await db.repositoryConnection.update({ where: { id: ids[2] }, data: { workspaceId: foreignWorkspace, installationId: `${foreignWorkspace}-installation` } });
        fireEvent.click(screen.getByRole("button", { name: "Apply gateway configuration" }));
        await waitFor(() => expect(screen.getByText(`fixture/${ids[0]}: applied (version 1)`)).toBeTruthy());
        expect(screen.getByText(`fixture/${ids[1]}: conflict`)).toBeTruthy();
        expect(screen.getByText(`fixture/${ids[2]}: denied`)).toBeTruthy();
        expect(screen.queryByText("Applied to every selected repository.")).toBeNull();
        const applied = await findReviewConfiguration(target(ids[0]), { configurations });
        expect(applied?.config.providers).toEqual([savedRequests[0]!.selection]);
        expect(applied?.config.provider).toEqual(savedRequests[0]!.selection);
        expect(applied?.config.blockingPolicy).toEqual(workspaceConfig.blockingPolicy);
        expect(applied?.config.limits).toEqual(workspaceConfig.limits);
        expect(applied?.config.reviewLanguage).toBe("French");
        expect(applied?.config.investigationRollout).toEqual(workspaceConfig.investigationRollout);
        expect(await findReviewConfiguration(target(ids[1]), { configurations })).toEqual(concurrent);
        expect(await findReviewConfiguration({ ...target(ids[2]), workspaceId: foreignWorkspace }, { configurations })).toBeNull();
        const operationId = savedRequests[0]!.operationId;
        expect((await adapter.read({ ...savedRequests[0]!, operationId: randomUUID() })).results.every((item) => item.status === "unknown")).toBe(true);
        const scopedRequest = { ...savedRequests[0]!, operationId, targets: [savedRequests[0]!.targets[0]!] };
        expect((await adapter.read(scopedRequest)).results).toEqual([{ repositoryId: ids[0], status: "applied", version: 1 }]);
        const changedSelection = { ...scopedRequest, selection: { ...scopedRequest.selection, model: "changed-model" } };
        expect((await adapter.read(changedSelection)).results).toEqual([{ repositoryId: ids[0], status: "conflict" }]);
        expect((await adapter.save(changedSelection)).results).toEqual([{ repositoryId: ids[0], status: "conflict" }]);
        expect((await adapter.read({ ...scopedRequest, targets: [{ repositoryId: ids[0], expectedVersion: 1 }] })).results)
          .toEqual([{ repositoryId: ids[0], status: "conflict" }]);
        expect((await findReviewConfiguration(target(ids[0]), { configurations }))?.version).toBe(1);
        // Fresh versions and changed eligibility must preserve all selected IDs
        // AND their original version snapshots, rather than silently replacing CAS.
        inventory = inventory.filter((item) => item.repositoryId !== ids[2]).map((item) => ({ ...item, expectedVersion: 1 }));
        view.rerender(element());
        expect(screen.getByText("3 repositories selected")).toBeTruthy();
        for (const id of ids.slice(0, 2)) expect((screen.getByLabelText(`Select fixture/${id} for gateway configuration`) as HTMLInputElement).checked).toBe(true);
        expect(screen.getByText(`Selected repository ${ids[2]} is no longer in the inventory.`)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Finish viewing results" }));
        fireEvent.click(screen.getByRole("button", { name: `Remove ${ids[2]} from selection` }));
        expect(screen.getByText("2 repositories selected")).toBeTruthy();
        for (const id of ids.slice(0, 2)) fireEvent.click(screen.getByLabelText(`Select fixture/${id} for gateway configuration`));
        fireEvent.click(screen.getByLabelText(`Select fixture/${ids[0]} for gateway configuration`));
        // A second deliberate operation loses its save response and first read.
        // Real durable receipt is recovered on the next user-triggered read only.
        loseResponse = true; loseRead = true;
        fireEvent.click(screen.getByRole("button", { name: "Apply gateway configuration" }));
        await waitFor(() => expect(refreshes).toBe(2));
        expect(response?.results).toEqual([{ repositoryId: ids[0], status: "applied", version: 2 }]);
        expect(savedRequests).toHaveLength(2);
        expect(savedRequests[1]!.targets[0]!.expectedVersion).toBe(1);
        const lostOperationId = savedRequests[1]!.operationId;
        expect(readRequests[0]!.operationId).toBe(lostOperationId);
        expect(readRequests[0]!.selection).toEqual(savedRequests[1]!.selection);
        expect(screen.getByText(`fixture/${ids[0]}: unknown`)).toBeTruthy();
        expect((screen.getByRole("button", { name: "Apply gateway configuration" }) as HTMLButtonElement).disabled).toBe(true);
        // Revocation while a save result is unknown cannot erase selection or
        // prevent an authorized read of an already-applied configuration receipt.
        await db.workspaceAccountBinding.update({ where: { id: "fixture-binding" }, data: {
          state: "revoked", revision: 2, policyRevision: 2,
          pendingFenceOperationId: "fixture-binding-revoke-intent",
          pendingFencePolicySubject: "fixture-binding", pendingFencePolicyRevision: 2,
        } });
        await entitlements.upsertWorkspaceEntitlement({ ...freeBetaEntitlement(workspaceId), status: "paused" });
        catalogUnavailable = true;
        currentAccounts = { status: "ok", value: { ...accounts.value, accounts: [] } };
        const retainedInventory = inventory;
        inventory = []; enabled = false;
        view.rerender(element());
        expect(screen.getByText("1 repositories selected")).toBeTruthy();
        expect(screen.getByText("The chosen account or model is no longer eligible. Your repository selection is preserved.")).toBeTruthy();
        expect(screen.getByText(`${ids[0]}: unknown`)).toBeTruthy();
        expect(screen.getByText(`Operation: ${lostOperationId}`)).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Finish viewing results" })).toBeNull();
        expect((screen.getByRole("button", { name: "Apply gateway configuration" }) as HTMLButtonElement).disabled).toBe(true);
        loseRead = false;
        fireEvent.click(screen.getByRole("button", { name: "Check saved operation" }));
        await waitFor(() => expect(screen.getByText(`${ids[0]}: applied (version 2)`)).toBeTruthy());
        inventory = retainedInventory; enabled = true;
        view.rerender(element());
        expect(screen.getByText("1 repositories selected")).toBeTruthy();
        expect(screen.getByText(`fixture/${ids[0]}: applied (version 2)`)).toBeTruthy();
        expect(readRequests[1]!.operationId).toBe(lostOperationId);
        expect(readRequests[1]!.targets).toEqual(savedRequests[1]!.targets);
        expect(readRequests[1]!.selection).toEqual(savedRequests[1]!.selection);
        expect(savedRequests).toHaveLength(2);
        expect((await findReviewConfiguration(target(ids[0]), { configurations }))?.version).toBe(2);
      } finally { HTMLElement.prototype.scrollIntoView = originalScroll; }
    } finally {
      cleanup();
      if (fixtureStarted) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await db.$disconnect();
      // Primary drops this exact disposable DB/cluster after the retained result.
    }
  },
  30000,
);
