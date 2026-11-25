import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  admin: vi.fn(),
  member: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  probe: vi.fn(),
  repository: vi.fn(),
  request: vi.fn(),
  octokit: vi.fn(),
}));
vi.mock("./dashboard-mutations", () => ({
  assertDashboardWorkspaceAdminAllowed: mocks.admin,
  createGitHubAppInstallationOctokit: mocks.octokit,
}));
vi.mock("./prisma", () => ({
  getPrisma: () => ({
    workspaceMember: { findFirst: mocks.member },
    repositoryConnection: { findFirst: mocks.repository },
    reviewContextConnection: {
      findUnique: mocks.find,
      findMany: mocks.list,
      create: mocks.create,
      updateMany: mocks.update,
    },
  }),
}));
vi.mock("@reviewrouter/features-auth", () => ({
  encryptServerToken: mocks.encrypt,
  decryptServerToken: mocks.decrypt,
}));
vi.mock("./context-tools-probe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context-tools-probe")>()),
  probeContextTools: mocks.probe,
}));
import { POST as TEST_CONNECTION } from "../../app/api/dashboard/context-tools/test/route";
import { GET, POST } from "../../app/api/dashboard/context-tools/route";
import {
  assertDashboardContextSelectionAllowed,
  importDashboardContextSelection,
  listDashboardContextConnections,
  saveDashboardContextConnection,
} from "./context-tools";
const definition = {
  id: "docs",
  url: "https://mcp.example.test/mcp",
  headers: { Authorization: "Bearer {{ secrets.DOCS_KEY }}" },
  tools: ["search_docs"],
  credentials: { DOCS_KEY: { source: "dashboard-secret" } },
};
const row = {
  workspaceId: "workspace",
  connectionId: "docs",
  revision: 1,
  enabled: true,
  definition,
  encryptedSecrets: "encrypted-fixture",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.admin.mockResolvedValue({ userId: "owner" });
  mocks.member.mockResolvedValue({ id: "membership" });
  mocks.find.mockResolvedValue(null);
  mocks.list.mockResolvedValue([row]);
  mocks.encrypt.mockReturnValue("encrypted-fixture");
  mocks.decrypt.mockReturnValue('{"DOCS_KEY":"secret-fixture"}');
  mocks.probe.mockResolvedValue([
    { name: "search_docs", description: "Read docs" },
  ]);
  mocks.octokit.mockResolvedValue({ request: mocks.request });
});
it("refuses reads and writes before touching connections when normal admin authorization fails", async () => {
  mocks.admin.mockRejectedValue(
    new Error("workspace_admin_forbidden:missing_role"),
  );
  expect(
    (
      await GET(
        new Request(
          "https://local.test/api/dashboard/context-tools?workspaceId=other",
        ),
      )
    ).status,
  ).toBe(403);
  await expect(
    saveDashboardContextConnection({
      workspaceId: "other",
      definition,
      expectedVersion: null,
      enabled: true,
      secrets: { DOCS_KEY: "secret-fixture" },
    }),
  ).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.encrypt).not.toHaveBeenCalled();
});
it("requires actual owner/admin membership even after a local operator authorization", async () => {
  mocks.member.mockResolvedValue(null);
  await expect(listDashboardContextConnections("other")).rejects.toThrow(
    "context_admin_required",
  );
  expect(mocks.member).toHaveBeenCalledWith({
    where: {
      workspaceId: "other",
      userId: "owner",
      role: { in: ["owner", "admin"] },
    },
    select: { id: true },
  });
  expect(mocks.list).not.toHaveBeenCalled();
});
it("encrypts submitted secrets and never echoes plaintext or ciphertext in POST/GET metadata", async () => {
  const response = await POST(
    new Request("https://local.test/api/dashboard/context-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace",
        definition,
        expectedVersion: null,
        enabled: true,
        secrets: { DOCS_KEY: "secret-fixture" },
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.encrypt).toHaveBeenCalledWith('{"DOCS_KEY":"secret-fixture"}');
  expect(mocks.create.mock.calls[0]?.[0].data.encryptedSecrets).toBe(
    "encrypted-fixture",
  );
  for (const result of [
    response,
    await GET(
      new Request(
        "https://local.test/api/dashboard/context-tools?workspaceId=workspace",
      ),
    ),
  ]) {
    const text = await result.text();
    expect(text).not.toContain("secret-fixture");
    expect(text).not.toContain("encrypted-fixture");
    expect(text).toContain('"present":true');
  }
});
it("returns safe CAS conflicts and bounds streamed request bodies before saving", async () => {
  mocks.find.mockResolvedValue(row);
  const response = await POST(
    new Request("https://local.test/api/dashboard/context-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace",
        definition,
        expectedVersion: null,
        enabled: true,
        secrets: { DOCS_KEY: "secret-fixture" },
      }),
    }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "context_connection_conflict",
  });
  expect(mocks.create).not.toHaveBeenCalled();
  const large = await POST(
    new Request("https://local.test/api/dashboard/context-tools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(32769),
    }),
  );
  expect(large.status).toBe(413);
});
it("rejects disabled, foreign and unapproved tools in policy selection", async () => {
  await expect(
    assertDashboardContextSelectionAllowed("workspace", {
      version: 1,
      builtinTools: [],
      mcp: [{ connection: "docs", tools: ["write_docs"] }],
    }),
  ).rejects.toThrow("context_connection_invalid");
  mocks.list.mockResolvedValue([{ ...row, enabled: false }]);
  await expect(
    assertDashboardContextSelectionAllowed("workspace", {
      version: 1,
      builtinTools: [],
      mcp: [{ connection: "docs", tools: ["search_docs"] }],
    }),
  ).rejects.toThrow("context_connection_invalid");
  mocks.list.mockResolvedValue([{ ...row, workspaceId: "foreign" }]);
  await expect(
    assertDashboardContextSelectionAllowed("workspace", {
      version: 1,
      builtinTools: [],
      mcp: [{ connection: "docs", tools: ["search_docs"] }],
    }),
  ).rejects.toThrow("context_connection_invalid");
});

it("previews only default-branch config at an immutable SHA and ignores unrelated config fields", async () => {
  const selection = {
    version: 1,
    builtinTools: ["github.issue.read"],
    mcp: [{ connection: "docs", tools: ["search_docs"] }],
  };
  const sourceCommit = "a".repeat(40);
  const bytes = Buffer.from(
    JSON.stringify({ unrelated: { ignored: true }, contextTools: selection }),
  );
  const sha = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
  mocks.repository.mockResolvedValue({
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    githubRepositoryId: 42n,
    installation: { githubInstallationId: 7n },
  });
  mocks.request
    .mockResolvedValueOnce({
      data: {
        id: 42,
        owner: { login: "owner" },
        name: "repo",
        default_branch: "main",
        archived: false,
      },
    })
    .mockResolvedValueOnce({
      data: {
        ref: "refs/heads/main",
        object: { type: "commit", sha: sourceCommit },
      },
    })
    .mockResolvedValueOnce({
      data: {
        type: "file",
        path: ".reviewrouter.json",
        encoding: "base64",
        size: bytes.length,
        content: bytes.toString("base64"),
        sha,
      },
    });
  expect(
    await importDashboardContextSelection("workspace", "repository"),
  ).toEqual({ selection, sourceCommit });
  expect(mocks.request).toHaveBeenLastCalledWith(
    "GET /repos/{owner}/{repo}/contents/{path}",
    {
      owner: "owner",
      repo: "repo",
      path: ".reviewrouter.json",
      ref: sourceCommit,
    },
  );
  expect(mocks.repository.mock.calls[0]?.[0].where).toMatchObject({
    id: "repository",
    workspaceId: "workspace",
    provider: "github",
    selected: true,
    archived: false,
    workspace: { deletionState: "active" },
    installation: { workspaceId: "workspace", status: "active" },
  });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.encrypt).not.toHaveBeenCalled();
});
it("rejects identity mismatch and tampered config bytes without producing a preview", async () => {
  mocks.repository.mockResolvedValue({
    owner: "owner",
    name: "repo",
    defaultBranch: "main",
    githubRepositoryId: 42n,
    installation: { githubInstallationId: 7n },
  });
  mocks.request.mockResolvedValueOnce({
    data: {
      id: 99,
      owner: { login: "owner" },
      name: "repo",
      default_branch: "main",
      archived: false,
    },
  });
  await expect(
    importDashboardContextSelection("workspace", "repository"),
  ).rejects.toThrow("context_connection_invalid");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  mocks.request
    .mockResolvedValueOnce({
      data: {
        id: 42,
        owner: { login: "owner" },
        name: "repo",
        default_branch: "main",
        archived: false,
      },
    })
    .mockResolvedValueOnce({
      data: {
        ref: "refs/heads/main",
        object: { type: "commit", sha: "a".repeat(40) },
      },
    })
    .mockResolvedValueOnce({
      data: {
        type: "file",
        path: ".reviewrouter.json",
        encoding: "base64",
        size: 2,
        content: "e30=",
        sha: "b".repeat(40),
      },
    });
  await expect(
    importDashboardContextSelection("workspace", "repository"),
  ).rejects.toThrow("context_connection_invalid");
});

function testRequest(
  override: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Request("https://local.test/api/dashboard/context-tools/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      workspaceId: "workspace",
      expectedVersion: null,
      definition: { ...definition, tools: [] },
      secrets: { DOCS_KEY: "secret-fixture" },
      ...override,
    }),
  });
}
it("refuses connection probes before reading/decrypting/networking without durable admin authorization", async () => {
  mocks.admin.mockRejectedValue(
    new Error("workspace_admin_forbidden:missing_role"),
  );
  expect((await TEST_CONNECTION(testRequest())).status).toBe(403);
  mocks.admin.mockResolvedValue({ userId: "owner" });
  mocks.member.mockResolvedValue(null);
  const result = await TEST_CONNECTION(testRequest());
  expect(result.status).toBe(403);
  expect(await result.json()).toEqual({
    ok: false,
    tools: [],
    error: "context_admin_required",
  });
  expect(mocks.find).not.toHaveBeenCalled();
  expect(mocks.decrypt).not.toHaveBeenCalled();
  expect(mocks.probe).not.toHaveBeenCalled();
});
it("tests unsaved draft and anonymous connections with no writes or encryption", async () => {
  const response = await TEST_CONNECTION(testRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    ok: true,
    tools: [{ name: "search_docs", description: "Read docs" }],
  });
  expect(mocks.probe).toHaveBeenCalledWith({
    url: definition.url,
    headers: { Authorization: "Bearer secret-fixture" },
    redact: ["secret-fixture", "Bearer secret-fixture"],
  });
  expect(
    (
      await TEST_CONNECTION(
        testRequest({
          definition: {
            ...definition,
            headers: {},
            credentials: {},
            tools: [],
          },
          secrets: undefined,
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.encrypt).not.toHaveBeenCalled();
});
it("reuses only an exact stored version and destination, while explicit replacements may test edited destinations", async () => {
  mocks.find.mockResolvedValue(row);
  const stored = { expectedVersion: 1, secrets: undefined };
  expect((await TEST_CONNECTION(testRequest(stored))).status).toBe(200);
  expect(mocks.decrypt).toHaveBeenCalledExactlyOnceWith("encrypted-fixture");
  mocks.decrypt.mockClear();
  mocks.probe.mockClear();
  for (const changed of [
    { ...definition, url: "https://other.example.test/mcp", tools: [] },
    {
      ...definition,
      headers: { Authorization: "Token {{ secrets.DOCS_KEY }}" },
      tools: [],
    },
    {
      ...definition,
      headers: { Authorization: "Bearer {{ secrets.OTHER }}" },
      credentials: { OTHER: { source: "dashboard-secret" } },
      tools: [],
    },
  ]) {
    const response = await TEST_CONNECTION(
      testRequest({ ...stored, definition: changed }),
    );
    expect(await response.json()).toEqual({
      ok: false,
      tools: [],
      error: "context_secret_reentry_required",
    });
  }
  expect(
    (await TEST_CONNECTION(testRequest({ expectedVersion: 2 }))).status,
  ).toBe(409);
  expect(mocks.decrypt).not.toHaveBeenCalled();
  expect(mocks.probe).not.toHaveBeenCalled();
  expect(
    (
      await TEST_CONNECTION(
        testRequest({
          expectedVersion: 1,
          definition: {
            ...definition,
            url: "https://other.example.test/mcp",
            tools: [],
          },
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.decrypt).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("returns safe actionable GitHub credential and decryption errors without any remote request", async () => {
  const github = await TEST_CONNECTION(
    testRequest({
      definition: {
        ...definition,
        credentials: {
          DOCS_KEY: { source: "github-secret", name: "DOCS_KEY" },
        },
        tools: [],
      },
      secrets: undefined,
    }),
  );
  expect(await github.json()).toEqual({
    ok: false,
    tools: [],
    error: "context_github_secret_unavailable",
  });
  mocks.find.mockResolvedValue(row);
  mocks.decrypt.mockImplementation(() => {
    throw new Error("private secret-fixture encrypted-fixture");
  });
  const response = await TEST_CONNECTION(
    testRequest({ expectedVersion: 1, secrets: undefined }),
  );
  expect(await response.json()).toEqual({
    ok: false,
    tools: [],
    error: "context_secret_unavailable",
  });
  expect(mocks.probe).not.toHaveBeenCalled();
});
it("rejects cross-origin, oversized and malformed probe requests before reaching the application", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("REVIEW_ROUTER_WEB_URL", "https://reviewrouter.org");
  try {
    const response = await TEST_CONNECTION(
      testRequest({}, { Origin: "https://attacker.test" }),
    );
    expect(response.status).toBe(403);
    const oversized = await TEST_CONNECTION(
      new Request("https://local.test/api/dashboard/context-tools/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "x".repeat(32769),
      }),
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({
      ok: false,
      tools: [],
      error: "context_request_too_large",
    });
    expect((await TEST_CONNECTION(testRequest({ enabled: true }))).status).toBe(
      400,
    );
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.probe).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
