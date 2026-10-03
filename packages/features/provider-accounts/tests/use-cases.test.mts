import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorkspaceAccessRepositoryPort } from "@reviewrouter/features-auth";
import type { ProviderAccountRepositoryPort } from "../src/application/ports/provider-account-repository-port";
import {
  bindWorkspaceAccount, resolveWorkspaceAccountBinding, revokeWorkspaceAccountBinding,
} from "../src/application/use-cases/workspace-account-bindings";
import {
  ProviderAccountError,
  type ConnectionState, type ProviderAccountConnection, type WorkspaceAccountBinding,
} from "../src/domain/provider-account";

const actor = { userId: "test-user", githubUserId: "910001", githubLogin: "synthetic-login" };
const scope = { workspaceId: "test-workspace", connectionId: "test-connection" };
const connection: ProviderAccountConnection = {
  id: scope.connectionId, owner: { kind: "workspace", workspaceId: scope.workspaceId },
  gatewayAccountRef: "gateway-account-test", gatewayOperationRef: null, profileRef: "profile-test",
  displayName: "Synthetic account", state: "active", metadataRevision: 1,
};
const denied = (code: string) => (error: unknown) => error instanceof ProviderAccountError && error.code === code;

function fixture() {
  let role: "admin" | "member" | null = "admin";
  let githubRole: "admin" | null = "admin";
  let githubReads = 0;
  let currentConnection = connection;
  let binding: WorkspaceAccountBinding | null = null;
  const workspaceAccess: WorkspaceAccessRepositoryPort = {
    async findWorkspaceRoleByUserId(input) { return input.workspaceId === scope.workspaceId && input.userId === actor.userId ? role : null; },
    async findWorkspaceRoleByGitHubUserId(input) { githubReads++; return input.workspaceId === scope.workspaceId && input.githubUserId === actor.githubUserId ? githubRole : null; },
    async listWorkspaceRolesByUserId() { throw new Error("unbounded_read_forbidden"); },
    async listWorkspaceRolesByGitHubUserId() { throw new Error("unbounded_read_forbidden"); },
  };
  // Small product-port fixture. Real race/SQL guarantees are tested on PostgreSQL.
  const accounts: ProviderAccountRepositoryPort = {
    async findOwnedConnection() { return currentConnection; },
    async findBinding(input) {
      return binding && binding.id === input.bindingId && binding.workspaceId === input.workspaceId
        ? { binding, connection: currentConnection } : null;
    },
    async compareAndSetBinding(input) {
      if ((binding?.revision ?? 0) !== input.expectedRevision || (!binding && input.state === "revoked")) {
        throw new ProviderAccountError("revision_conflict");
      }
      binding = { id: "binding-test", workspaceId: input.workspaceId, connectionId: input.connectionId, state: input.state, revision: (binding?.revision ?? 0) + 1 };
      return binding;
    },
  };
  return {
    dependencies: { workspaceAccess, accounts },
    setRole(value: typeof role) { role = value; },
    setGitHubRole(value: typeof githubRole) { githubRole = value; },
    setConnection(value: ProviderAccountConnection) { currentConnection = value; },
    get githubReads() { return githubReads; },
  };
}
const bind = (f: ReturnType<typeof fixture>, expectedRevision = 0) => bindWorkspaceAccount({ ...scope, actor, expectedRevision }, f.dependencies);
const resolve = (f: ReturnType<typeof fixture>, overrides = {}) => resolveWorkspaceAccountBinding({ workspaceId: scope.workspaceId, bindingId: "binding-test", actor, ...overrides }, f.dependencies);

// Regression: a member can change a binding, or membership removal is cached.
test("live member reads, admin changes, and subsequent membership removal", async () => {
  const f = fixture();
  await bind(f);
  f.setRole("member");
  assert.deepEqual(await resolve(f), {
    workspaceId: "test-workspace", bindingId: "binding-test", bindingRevision: 1,
    connectionId: "test-connection", gatewayAccountRef: "gateway-account-test", profileRef: "profile-test",
  });
  await assert.rejects(bind(f, 1), denied("workspace_forbidden"));
  await assert.rejects(revokeWorkspaceAccountBinding({ ...scope, actor, expectedRevision: 1 }, f.dependencies), denied("workspace_forbidden"));
  f.setRole(null);
  await assert.rejects(resolve(f), denied("workspace_forbidden"));
  await assert.rejects(bind(f, 1), denied("workspace_forbidden"));
  assert.equal(f.githubReads, 0);
  f.setRole("admin");
  assert.equal((await bind(f, 1)).revision, 2);
  // Stable product identity also works without a GitHub identity/login.
  assert.equal((await bindWorkspaceAccount({ ...scope, actor: { userId: actor.userId, githubUserId: "", githubLogin: "" }, expectedRevision: 2 }, f.dependencies)).revision, 3);
});

// Regression: present stable userId falls back to a different GitHub/login role.
test("stable user ID never falls back; absent ID uses immutable GitHub ID", async () => {
  const f = fixture();
  f.setRole(null);
  await assert.rejects(bind(f), denied("workspace_forbidden"));
  assert.equal(f.githubReads, 0);
  const githubActor = { githubUserId: actor.githubUserId, githubLogin: "renamed-synthetic-login" };
  assert.equal((await bindWorkspaceAccount({ ...scope, actor: githubActor, expectedRevision: 0 }, f.dependencies)).revision, 1);
  f.setGitHubRole(null);
  await assert.rejects(resolve(f, { actor: githubActor }), denied("workspace_forbidden"));
  await assert.rejects(bindWorkspaceAccount({ ...scope, actor: { ...actor, userId: "" }, expectedRevision: 1 }, f.dependencies), denied("invalid_input"));
});

// Regression: local override bypasses ownership, or ownerUser becomes implicit sharing.
test("configured local override uses auth seam while owner policy remains closed", async () => {
  const f = fixture();
  f.setRole(null);
  const dependencies = { ...f.dependencies, localAdminGithubLogins: ["SYNTHETIC-LOGIN"] };
  assert.equal((await bindWorkspaceAccount({ ...scope, actor, expectedRevision: 0 }, dependencies)).revision, 1);
  for (const owner of [{ kind: "workspace", workspaceId: "foreign-workspace" }, { kind: "user", userId: actor.userId }] as const) {
    f.setConnection({ ...connection, owner });
    await assert.rejects(bindWorkspaceAccount({ ...scope, actor, expectedRevision: 1 }, dependencies), denied("connection_unavailable"));
    await assert.rejects(resolveWorkspaceAccountBinding({ workspaceId: scope.workspaceId, bindingId: "binding-test", actor }, dependencies), denied("connection_unavailable"));
  }
});

// Regression: a stale bind revives local revocation, or missing revision overwrites.
test("CAS rejects stale/missing revisions; revoked selection stays denied until a fresh bind", async () => {
  const f = fixture();
  await assert.rejects(bind(f, 1), denied("revision_conflict"));
  await assert.rejects(revokeWorkspaceAccountBinding({ ...scope, actor, expectedRevision: 0 }, f.dependencies), denied("invalid_input"));
  await bind(f);
  await assert.rejects(bind(f), denied("revision_conflict"));
  assert.equal((await revokeWorkspaceAccountBinding({ ...scope, actor, expectedRevision: 1 }, f.dependencies)).revision, 2);
  await assert.rejects(resolve(f), denied("binding_unavailable"));
  await assert.rejects(bind(f, 1), denied("revision_conflict"));
  await assert.rejects(resolve(f), denied("binding_unavailable"));
  assert.equal((await bind(f, 2)).revision, 3);
  assert.equal((await resolve(f)).bindingRevision, 3);
});

// Regression: a gateway unknown/inactive state is treated as executable locally.
test("bind and selection fail closed for inactive/future states; revocation can clean them up", async () => {
  const f = fixture();
  await bind(f);
  for (const state of ["disabled", "quarantined", "pending", "unknown", "future-state"] as ConnectionState[]) {
    f.setConnection({ ...connection, state });
    await assert.rejects(bind(f, 1), denied("connection_unavailable"));
    await assert.rejects(resolve(f), denied("connection_unavailable"));
  }
  assert.equal((await revokeWorkspaceAccountBinding({ ...scope, actor, expectedRevision: 1 }, f.dependencies)).state, "revoked");
});

// Regression: a valid binding string ID can be selected in another current workspace.
test("foreign workspace and missing binding selection are denied", async () => {
  const f = fixture();
  await bind(f);
  await assert.rejects(resolve(f, { workspaceId: "foreign-workspace" }), denied("workspace_forbidden"));
  await assert.rejects(resolve(f, { bindingId: "missing-binding" }), denied("binding_unavailable"));
});
