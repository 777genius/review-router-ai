import {
  assertWorkspaceAdminAllowed,
  type AssertWorkspaceAdminAllowedInput,
  type WorkspaceAccessRepositoryPort,
} from "@reviewrouter/features-auth";
import {
  ProviderAccountError, assertExecutable, assertExpectedRevision, assertOpaqueReference,
  assertWorkspaceOwner, selectBinding,
  type BindingScope, type SafeBindingTuple, type WorkspaceAccountBinding,
} from "../../domain/provider-account";
import type { ProviderAccountRepositoryPort } from "../ports/provider-account-repository-port";

export type WorkspaceAccountActor = Pick<AssertWorkspaceAdminAllowedInput, "userId" | "githubUserId" | "githubLogin">;
export type ProviderAccountDependencies = {
  readonly accounts: ProviderAccountRepositoryPort;
  readonly workspaceAccess: WorkspaceAccessRepositoryPort;
  // Trusted composition config, never a caller-controlled permission input.
  readonly localAdminGithubLogins?: readonly string[];
};

function assertActor(actor: WorkspaceAccountActor): void {
  if (actor.userId !== undefined) assertOpaqueReference(actor.userId);
  if (typeof actor.githubUserId !== "string" || typeof actor.githubLogin !== "string" ||
      (actor.userId === undefined && !/^[0-9]+$/.test(actor.githubUserId))) {
    throw new ProviderAccountError("invalid_input");
  }
}

type MutationInput = BindingScope & {
  readonly actor: WorkspaceAccountActor;
  readonly expectedRevision: number;
};

async function assertAdmin(
  workspaceId: string, actor: WorkspaceAccountActor, dependencies: ProviderAccountDependencies,
): Promise<void> {
  try {
    await assertWorkspaceAdminAllowed({
      workspaceId, userId: actor.userId,
      githubUserId: actor.githubUserId, githubLogin: actor.githubLogin,
      ...(dependencies.localAdminGithubLogins ? { localAdminGithubLogins: dependencies.localAdminGithubLogins } : {}),
    }, { workspaceAccess: dependencies.workspaceAccess });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("workspace_admin_forbidden:")) {
      throw new ProviderAccountError("workspace_forbidden");
    }
    throw error;
  }
}

async function changeBinding(
  input: MutationInput, dependencies: ProviderAccountDependencies, state: "active" | "revoked",
): Promise<WorkspaceAccountBinding> {
  assertActor(input.actor);
  assertOpaqueReference(input.workspaceId);
  assertOpaqueReference(input.connectionId);
  assertExpectedRevision(input.expectedRevision, state === "active");
  // Always query live auth at the application boundary; no cached role/paid-pool grant.
  await assertAdmin(input.workspaceId, input.actor, dependencies);
  const connection = await dependencies.accounts.findOwnedConnection(input);
  assertWorkspaceOwner(connection, input.workspaceId);
  if (state === "active") assertExecutable(connection);
  return dependencies.accounts.compareAndSetBinding({
    workspaceId: input.workspaceId, connectionId: input.connectionId,
    expectedRevision: input.expectedRevision, state,
  });
}
export function bindWorkspaceAccount(input: MutationInput, dependencies: ProviderAccountDependencies): Promise<WorkspaceAccountBinding> {
  return changeBinding(input, dependencies, "active");
}
/** Local denial only. This is not a remote gateway disable/fence acknowledgment. */
export function revokeWorkspaceAccountBinding(input: MutationInput, dependencies: ProviderAccountDependencies): Promise<WorkspaceAccountBinding> {
  return changeBinding(input, dependencies, "revoked");
}
export async function resolveWorkspaceAccountBinding(input: {
  readonly workspaceId: string;
  readonly bindingId: string;
  readonly actor: WorkspaceAccountActor;
}, dependencies: ProviderAccountDependencies): Promise<SafeBindingTuple> {
  assertActor(input.actor);
  assertOpaqueReference(input.workspaceId);
  assertOpaqueReference(input.bindingId);
  const role = input.actor.userId
    ? await dependencies.workspaceAccess.findWorkspaceRoleByUserId({ workspaceId: input.workspaceId, userId: input.actor.userId })
    : await dependencies.workspaceAccess.findWorkspaceRoleByGitHubUserId({ workspaceId: input.workspaceId, githubUserId: input.actor.githubUserId });
  // Members may read/select in their current workspace; missing membership must
  // pass the existing explicit local override seam. No login-role fallback.
  if (!role) await assertAdmin(input.workspaceId, input.actor, dependencies);
  const selection = await dependencies.accounts.findBinding({ workspaceId: input.workspaceId, bindingId: input.bindingId });
  return selectBinding(input.workspaceId, input.bindingId, selection);
}
