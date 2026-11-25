import { describe, expect, it } from "vitest";
import {
  executeProviderApiKeyWorkspaceAccess,
  parseProviderApiKeyWorkspaceAccessArgs,
  serializeProviderApiKeyWorkspaceAccessError,
  type ProviderApiKeyWorkspaceAccessDatabase,
  type ProviderApiKeyWorkspaceAccessRequest,
  type ProviderApiKeyWorkspaceGrantRecord,
} from "./provider-api-key-workspace-access.js";

type DatabaseCall = {
  readonly kind: "workspace" | "grant-read" | "grant-upsert" | "grant-delete";
  readonly input: unknown;
};

type FakeGrantRecord = ProviderApiKeyWorkspaceGrantRecord & {
  readonly encryptedApiKey?: string;
};

describe("provider API key workspace access operator", () => {
  it("inspects only the exact workspace and non-secret grant status", async () => {
    const { database, calls } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [
        {
          ...grantRecord({
            id: "grant-existing",
            workspaceId: "workspace-test",
            grantedBy: "operator@example.test",
            grantReason: "synthetic workspace setup",
          }),
          encryptedApiKey: "encrypted-api-key-canary",
        },
      ],
    });

    const result = await executeProviderApiKeyWorkspaceAccess(
      request({ action: "inspect" }),
      database,
    );

    expect(result).toEqual({
      action: "inspect",
      mode: "inspect",
      status: "observed",
      workspaceId: "workspace-test",
      mutation: false,
      audit: {
        actor: "operator@example.test",
        reason: "synthetic workspace setup",
      },
      grant: {
        id: "grant-existing",
        grantedBy: "operator@example.test",
        grantReason: "synthetic workspace setup",
        createdAt: "2026-09-27T00:00:00.000Z",
        updatedAt: "2026-09-27T00:01:00.000Z",
      },
    });
    expect(calls.map((call) => call.kind)).toEqual(["workspace", "grant-read"]);
    expect(JSON.stringify(result)).not.toContain("encrypted-api-key");
  });

  it("allows a read-only dry run without confirmation and performs no mutation", async () => {
    const { database, calls } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [],
    });

    const result = await executeProviderApiKeyWorkspaceAccess(
      request({ action: "grant", confirm: false, dryRun: true }),
      database,
    );

    expect(result).toMatchObject({
      mode: "dry-run",
      status: "planned",
      mutation: false,
      grant: null,
    });
    expect(calls.map((call) => call.kind)).toEqual(["workspace", "grant-read"]);
  });

  it("denies an unconfirmed write before any database mutation", async () => {
    const { database, calls } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [],
    });

    await expect(
      executeProviderApiKeyWorkspaceAccess(
        request({ action: "grant", confirm: false }),
        database,
      ),
    ).rejects.toMatchObject({ code: "confirmation_required" });
    expect(calls).toEqual([]);
  });

  it("records the requested actor and reason on the exact workspace grant", async () => {
    const { database, calls } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [],
    });

    const result = await executeProviderApiKeyWorkspaceAccess(
      request({ action: "grant", confirm: true }),
      database,
    );

    expect(result).toMatchObject({
      status: "granted",
      mutation: true,
      grant: {
        id: "grant-created",
        grantedBy: "operator@example.test",
        grantReason: "synthetic workspace setup",
      },
    });
    expect(calls.map((call) => call.kind)).toEqual([
      "workspace",
      "grant-read",
      "grant-upsert",
    ]);
    expect(calls).toContainEqual({
      kind: "grant-upsert",
      input: {
        where: { workspaceId: "workspace-test" },
        update: {
          grantedBy: "operator@example.test",
          grantReason: "synthetic workspace setup",
        },
        create: {
          workspaceId: "workspace-test",
          grantedBy: "operator@example.test",
          grantReason: "synthetic workspace setup",
        },
        select: {
          id: true,
          workspaceId: true,
          grantedBy: true,
          grantReason: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    });
  });

  it("revokes only the observed grant ID and exact workspace ID", async () => {
    const { database, calls } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [
        grantRecord({
          id: "grant-existing",
          workspaceId: "workspace-test",
        }),
      ],
    });

    const result = await executeProviderApiKeyWorkspaceAccess(
      request({ action: "revoke", confirm: true }),
      database,
    );

    expect(result).toMatchObject({
      status: "revoked",
      mutation: true,
      grant: null,
    });
    expect(calls.map((call) => call.kind)).toEqual([
      "workspace",
      "grant-read",
      "grant-delete",
    ]);
    expect(calls).toContainEqual({
      kind: "grant-delete",
      input: {
        where: {
          id: "grant-existing",
          workspaceId: "workspace-test",
        },
      },
    });
  });

  it.each([
    {
      name: "missing workspace",
      workspaces: [],
      expected: "workspace_missing",
    },
    {
      name: "ambiguous workspace",
      workspaces: [{ id: "workspace-test" }, { id: "workspace-test" }],
      expected: "workspace_ambiguous",
    },
    {
      name: "wrong workspace target",
      workspaces: [{ id: "workspace-other" }],
      expected: "workspace_target_mismatch",
    },
  ])(
    "fails closed for $name before mutation",
    async ({ workspaces, expected }) => {
      const { database, calls } = fakeDatabase({
        workspaces,
        grants: [],
      });

      await expect(
        executeProviderApiKeyWorkspaceAccess(
          request({ action: "grant", confirm: true }),
          database,
        ),
      ).rejects.toMatchObject({ code: expected });
      expect(calls.map((call) => call.kind)).not.toContain("grant-upsert");
    },
  );

  it("fails closed for an ambiguous or wrong current grant before mutation", async () => {
    for (const grants of [
      [
        grantRecord({ id: "grant-one", workspaceId: "workspace-test" }),
        grantRecord({ id: "grant-two", workspaceId: "workspace-test" }),
      ],
      [grantRecord({ id: "grant-one", workspaceId: "workspace-other" })],
    ]) {
      const { database, calls } = fakeDatabase({
        workspaces: [{ id: "workspace-test" }],
        grants,
      });

      await expect(
        executeProviderApiKeyWorkspaceAccess(
          request({ action: "revoke", confirm: true }),
          database,
        ),
      ).rejects.toMatchObject({
        code:
          grants.length > 1
            ? "workspace_grant_ambiguous"
            : "workspace_grant_target_mismatch",
      });
      expect(calls.map((call) => call.kind)).not.toContain("grant-delete");
    }
  });

  it("fails closed when the revoke target changes after the pre-read", async () => {
    const { database } = fakeDatabase({
      workspaces: [{ id: "workspace-test" }],
      grants: [
        grantRecord({ id: "grant-existing", workspaceId: "workspace-test" }),
      ],
      deleteCount: 0,
    });

    await expect(
      executeProviderApiKeyWorkspaceAccess(
        request({ action: "revoke", confirm: true }),
        database,
      ),
    ).rejects.toMatchObject({ code: "revoke_target_changed" });
  });

  it("requires explicit action, workspace ID, actor, and reason", () => {
    expect(() => parseProviderApiKeyWorkspaceAccessArgs([])).toThrow(
      "action_must_be_grant_revoke_or_inspect",
    );
    expect(() =>
      parseProviderApiKeyWorkspaceAccessArgs([
        "grant",
        "--actor",
        "operator@example.test",
        "--reason",
        "synthetic workspace setup",
      ]),
    ).toThrow("missing_required:--workspace-id");
    expect(() =>
      parseProviderApiKeyWorkspaceAccessArgs([
        "grant",
        "--workspace-id",
        "workspace-test",
        "--actor",
        "operator@example.test",
      ]),
    ).toThrow("missing_required:--reason");
    expect(() =>
      parseProviderApiKeyWorkspaceAccessArgs([
        "grant",
        "--workspace-id",
        "workspace-test",
        "--reason",
        "synthetic workspace setup",
      ]),
    ).toThrow("missing_required:--actor");
  });

  it("does not expose raw database or provider-key failures", () => {
    const serialized = serializeProviderApiKeyWorkspaceAccessError(
      new Error(
        "failure containing postgresql://database-canary and encrypted-api-key-canary",
      ),
    );

    expect(serialized).toBe(
      '{"error":"provider_api_key_workspace_access_failed"}\n',
    );
    expect(serialized).not.toContain("database-canary");
    expect(serialized).not.toContain("encrypted-api-key-canary");
  });
});

function request(
  overrides: Partial<ProviderApiKeyWorkspaceAccessRequest> = {},
): ProviderApiKeyWorkspaceAccessRequest {
  return {
    action: "inspect",
    workspaceId: "workspace-test",
    actor: "operator@example.test",
    reason: "synthetic workspace setup",
    confirm: false,
    dryRun: false,
    ...overrides,
  };
}

function grantRecord(
  overrides: Partial<ProviderApiKeyWorkspaceGrantRecord> = {},
): ProviderApiKeyWorkspaceGrantRecord {
  return {
    id: "grant-existing",
    workspaceId: "workspace-test",
    grantedBy: "operator@example.test",
    grantReason: "synthetic workspace setup",
    createdAt: new Date("2026-09-27T00:00:00.000Z"),
    updatedAt: new Date("2026-09-27T00:01:00.000Z"),
    ...overrides,
  };
}

function fakeDatabase(input: {
  readonly workspaces: readonly { readonly id: string }[];
  readonly grants: readonly FakeGrantRecord[];
  readonly deleteCount?: number;
}): {
  readonly database: ProviderApiKeyWorkspaceAccessDatabase;
  readonly calls: DatabaseCall[];
} {
  const calls: DatabaseCall[] = [];
  const database: ProviderApiKeyWorkspaceAccessDatabase = {
    workspace: {
      findMany: async (query) => {
        calls.push({ kind: "workspace", input: query });
        return input.workspaces.slice(0, query.take);
      },
    },
    providerApiKeyWorkspaceGrant: {
      findMany: async (query) => {
        calls.push({ kind: "grant-read", input: query });
        return input.grants.slice(0, query.take);
      },
      upsert: async (query) => {
        calls.push({ kind: "grant-upsert", input: query });
        return grantRecord({
          id: "grant-created",
          workspaceId: query.where.workspaceId,
          grantedBy: query.create.grantedBy,
          grantReason: query.create.grantReason,
        });
      },
      deleteMany: async (query) => {
        calls.push({ kind: "grant-delete", input: query });
        return { count: input.deleteCount ?? 1 };
      },
    },
  };
  return { database, calls };
}
