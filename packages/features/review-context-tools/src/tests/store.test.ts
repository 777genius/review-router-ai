import { describe, expect, it, vi } from "vitest";
import {
  deliverContextCredentials,
  listContextConnectionMetadata,
  saveContextConnection,
  type ContextConnectionStore,
} from "../application/connections.js";
import {
  captureContextToolsPlan,
  contextPlanDigest,
  type ContextConnection,
  type ContextConnectionDefinition,
  type ContextToolsPlan,
} from "../domain/context-tools.js";

const definition: ContextConnectionDefinition = {
  id: "docs",
  url: "https://mcp.example.com/api",
  tools: ["search", "read"],
  headers: {
    Authorization: "Bearer ${{ secrets.DOCS_KEY }}",
    "X-GitHub-Key": "${{ secrets.GITHUB_KEY }}",
  },
  credentials: {
    DOCS_KEY: { source: "dashboard-secret" },
    GITHUB_KEY: { source: "github-secret", name: "ORG_DOCS_KEY" },
  },
};
class MemoryStore implements ContextConnectionStore {
  rows: ContextConnection[] = [];
  rejectSave = false;
  async find(workspaceId: string, id: string) {
    return (
      this.rows.find(
        (c) => c.workspaceId === workspaceId && c.definition.id === id,
      ) ?? null
    );
  }
  async list(workspaceId: string) {
    return this.rows.filter((c) => c.workspaceId === workspaceId);
  }
  async save(connection: ContextConnection, expectedVersion: number | null) {
    const current = await this.find(
      connection.workspaceId,
      connection.definition.id,
    );
    if (this.rejectSave || (current?.version ?? null) !== expectedVersion)
      return false;
    this.rows = this.rows.filter((c) => c !== current).concat(connection);
    return true;
  }
}
function fixture() {
  const store = new MemoryStore();
  const encrypted = new Map<string, string>();
  const crypto = {
    encrypt: vi.fn((value: string) => {
      const id = `ciphertext-${encrypted.size}`;
      encrypted.set(id, value);
      return id;
    }),
    decrypt: vi.fn((id: string) => {
      const value = encrypted.get(id);
      if (!value) throw new Error("private decryption detail");
      return value;
    }),
  };
  const deps = { store, crypto };
  const create = (workspaceId = "w1", def = definition) =>
    saveContextConnection(
      {
        workspaceId,
        expectedVersion: null,
        enabled: true,
        definition: def,
        secrets: { DOCS_KEY: "private-dashboard-value" },
      },
      deps,
    );
  const plan = (workspaceId = "w1") =>
    captureContextToolsPlan(
      {
        version: 1,
        builtinTools: [],
        mcp: [{ connection: "docs", tools: ["search"] }],
      },
      store.rows.filter((c) => c.workspaceId === workspaceId),
    );
  return { ...deps, deps, create, plan, encrypted };
}
function resigned(plan: ContextToolsPlan): ContextToolsPlan {
  const { planDigest: _digest, ...rest } = plan;
  void _digest;
  return { ...rest, planDigest: contextPlanDigest(rest) };
}

describe("context connection secrets and revision boundary", () => {
  it("persists ciphertext only, returns safe metadata, and retains omitted secrets", async () => {
    const f = fixture();
    const created = await f.create();
    expect(f.store.rows[0]?.encryptedSecrets).toBe("ciphertext-0");
    expect(JSON.stringify(f.store.rows)).not.toContain(
      "private-dashboard-value",
    );
    const listed = await listContextConnectionMetadata("w1", f.store);
    expect(listed).toEqual([created]);
    expect(JSON.stringify(listed)).not.toMatch(
      /private-dashboard-value|ciphertext-0|encryptedSecrets/,
    );
    expect(created.credentials).toEqual([
      { name: "DOCS_KEY", source: "dashboard-secret", present: true },
      { name: "GITHUB_KEY", source: "github-secret", present: false },
    ]);
    await saveContextConnection(
      { workspaceId: "w1", expectedVersion: 1, definition, enabled: false },
      f.deps,
    );
    expect(f.store.rows[0]).toMatchObject({
      version: 2,
      enabled: false,
      encryptedSecrets: "ciphertext-0",
    });
    expect(f.crypto.encrypt).toHaveBeenCalledTimes(1);
    expect(f.crypto.decrypt).not.toHaveBeenCalled();
  });

  it("rejects missing, blank, extra, GitHub and oversized secret values without writes", async () => {
    const f = fixture();
    const invalidSecrets: (Record<string, string> | undefined)[] = [
      undefined,
      {},
      { DOCS_KEY: "" },
      { DOCS_KEY: "  " },
      { DOCS_KEY: "header\r\ninjection" },
      { DOCS_KEY: "x", OTHER: "y" },
      { DOCS_KEY: "x", GITHUB_KEY: "github-private" },
      { DOCS_KEY: "x".repeat(8193) },
      { DOCS_KEY: "é".repeat(4097) },
    ];
    for (const secrets of invalidSecrets) {
      await expect(
        saveContextConnection(
          {
            workspaceId: "w1",
            expectedVersion: null,
            enabled: true,
            definition,
            ...(secrets === undefined ? {} : { secrets }),
          },
          f.deps,
        ),
      ).rejects.toMatchObject({ code: "context_secret_invalid" });
    }
    expect(f.store.rows).toEqual([]);
    expect(f.crypto.encrypt).not.toHaveBeenCalled();
    await expect(
      saveContextConnection(
        {
          workspaceId: "w1",
          expectedVersion: null,
          enabled: true,
          definition,
          secrets: { DOCS_KEY: "é".repeat(4096) },
        },
        f.deps,
      ),
    ).resolves.toMatchObject({ version: 1 });
  });

  it("rejects stale and raced CAS updates without changing persisted state", async () => {
    const f = fixture();
    await f.create();
    const original = structuredClone(f.store.rows);
    await expect(
      saveContextConnection(
        {
          workspaceId: "w1",
          expectedVersion: null,
          enabled: false,
          definition,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: "context_connection_conflict" });
    f.store.rejectSave = true;
    await expect(
      saveContextConnection(
        { workspaceId: "w1", expectedVersion: 1, enabled: false, definition },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: "context_connection_conflict" });
    expect(f.store.rows).toEqual(original);
  });

  it("scopes equal connection IDs by workspace and requires values for changed Dashboard bindings", async () => {
    const f = fixture();
    await f.create();
    await f.create("w2");
    await saveContextConnection(
      { workspaceId: "w2", expectedVersion: 1, enabled: false, definition },
      f.deps,
    );
    expect((await f.store.find("w1", "docs"))?.enabled).toBe(true);
    expect(await listContextConnectionMetadata("w3", f.store)).toEqual([]);
    const changed = {
      ...definition,
      headers: { Authorization: "Bearer ${{ secrets.OTHER }}" },
      credentials: { OTHER: { source: "dashboard-secret" as const } },
    };
    await expect(
      saveContextConnection(
        {
          workspaceId: "w1",
          expectedVersion: 1,
          enabled: true,
          definition: changed,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: "context_secret_invalid" });
    expect((await f.store.find("w1", "docs"))?.version).toBe(1);
  });

  it("rejects invalid header templates without reflecting submitted values", async () => {
    const f = fixture();
    for (const headers of [
      { Authorization: "private-raw-token" },
      { Authorization: "Bearer ${{ secrets.OTHER }}" },
      { Authorization: "${{ secrets.DOCS_KEY }}\r\nx-private: value" },
      { Authorization: "{{ env.DOCS_KEY }}" },
    ]) {
      await expect(
        saveContextConnection(
          {
            workspaceId: "w1",
            expectedVersion: null,
            enabled: true,
            definition: { ...definition, headers },
            secrets: { DOCS_KEY: "private-value" },
          },
          f.deps,
        ),
      ).rejects.toMatchObject({
        message: "context_connection_invalid",
        code: "context_connection_invalid",
      });
    }
    expect(f.store.rows).toEqual([]);
  });
});

it("requires explicit Dashboard credential replacement before saving a changed endpoint or header binding", async () => {
  const f = fixture();
  await f.create();
  for (const changed of [
    { ...definition, url: "https://other.example.com/mcp" },
    {
      ...definition,
      headers: {
        ...definition.headers,
        Authorization: "Token {{ secrets.DOCS_KEY }}",
      },
    },
  ]) {
    await expect(
      saveContextConnection(
        {
          workspaceId: "w1",
          expectedVersion: 1,
          definition: changed,
          enabled: true,
        },
        f.deps,
      ),
    ).rejects.toMatchObject({ code: "context_secret_reentry_required" });
  }
  expect((await f.store.find("w1", "docs"))?.version).toBe(1);
  expect(f.crypto.decrypt).not.toHaveBeenCalled();
  await expect(
    saveContextConnection(
      {
        workspaceId: "w1",
        expectedVersion: 1,
        definition: { ...definition, url: "https://other.example.com/mcp" },
        enabled: true,
        secrets: { DOCS_KEY: "new-secret" },
      },
      f.deps,
    ),
  ).resolves.toMatchObject({ version: 2 });
});

describe("captured context credential delivery", () => {
  it("delivers only selected Dashboard values and never supplies GitHub values", async () => {
    const f = fixture();
    await f.create();
    await f.create("w1", { ...definition, id: "unused" });
    expect(await deliverContextCredentials("w1", f.plan(), f.deps)).toEqual({
      DOCS_KEY: "private-dashboard-value",
    });
    expect(f.crypto.decrypt).toHaveBeenCalledTimes(1);
    expect(f.crypto.decrypt).toHaveBeenCalledWith("ciphertext-0");
  });

  it("rejects cross-workspace, disabled and changed revisions before decrypting", async () => {
    const f = fixture();
    await f.create();
    const plan = f.plan();
    await expect(
      deliverContextCredentials("w2", plan, f.deps),
    ).rejects.toMatchObject({ code: "context_plan_unavailable" });
    await saveContextConnection(
      { workspaceId: "w1", expectedVersion: 1, enabled: false, definition },
      f.deps,
    );
    await expect(
      deliverContextCredentials("w1", plan, f.deps),
    ).rejects.toMatchObject({ code: "context_plan_unavailable" });
    await saveContextConnection(
      { workspaceId: "w1", expectedVersion: 2, enabled: true, definition },
      f.deps,
    );
    await expect(
      deliverContextCredentials("w1", plan, f.deps),
    ).rejects.toMatchObject({ code: "context_plan_unavailable" });
    expect(f.crypto.decrypt).not.toHaveBeenCalled();
  });

  it("preflights every server and rejects forged bindings/tools/definition even with valid digest", async () => {
    const f = fixture();
    await f.create();
    const plan = f.plan();
    const server = plan.servers[0]!;
    const variants: ContextToolsPlan[] = [
      { ...plan, servers: [{ ...server, tools: ["admin"] }] },
      {
        ...plan,
        servers: [{ ...server, url: "https://attacker.example/api" }],
      },
      {
        ...plan,
        servers: [
          {
            ...server,
            credentials: {
              ...server.credentials,
              DOCS_KEY: {
                source: "dashboard-secret",
                credentialRef: "other",
                version: 1,
              },
            },
          },
        ],
      },
      {
        ...plan,
        servers: [
          server,
          {
            ...server,
            id: "missing",
            credentials: {
              ...server.credentials,
              DOCS_KEY: {
                source: "dashboard-secret",
                credentialRef: "missing",
                version: 1,
              },
            },
          },
        ],
      },
    ];
    for (const variant of variants)
      await expect(
        deliverContextCredentials("w1", resigned(variant), f.deps),
      ).rejects.toMatchObject({ code: "context_plan_unavailable" });
    expect(f.crypto.decrypt).not.toHaveBeenCalled();
  });

  it("rejects flat logical-name collisions and malformed ciphertext with safe errors", async () => {
    const f = fixture();
    await f.create();
    const plan = f.plan();
    const server = plan.servers[0]!;
    const ambiguous = resigned({
      ...plan,
      servers: [
        server,
        {
          ...server,
          id: "other",
          credentials: {
            ...server.credentials,
            DOCS_KEY: {
              source: "dashboard-secret",
              credentialRef: "other",
              version: 1,
            },
          },
        },
      ],
    });
    await expect(
      deliverContextCredentials("w1", ambiguous, f.deps),
    ).rejects.toMatchObject({ code: "context_plan_unavailable" });
    expect(f.crypto.decrypt).not.toHaveBeenCalled();
    f.encrypted.set(
      "ciphertext-0",
      JSON.stringify({
        DOCS_KEY: "private-dashboard-value",
        GITHUB_KEY: "private-github-value",
      }),
    );
    await expect(
      deliverContextCredentials("w1", plan, f.deps),
    ).rejects.toMatchObject({
      message: "context_secret_unavailable",
      code: "context_secret_unavailable",
    });
  });
});
