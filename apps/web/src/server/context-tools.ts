import { createHash } from "node:crypto";
import { z } from "zod";
import {
  decryptServerToken,
  encryptServerToken,
} from "@reviewrouter/features-auth";
import {
  ContextConnectionError,
  captureContextToolsPlan,
  contextToolsSelectionSchema,
  listContextConnectionMetadata,
  PrismaContextConnectionStore,
  saveContextConnection,
  prepareContextConnectionProbe,
  type ContextConnectionProbeInput,
  type ContextToolsSelection,
} from "@reviewrouter/features-review-context-tools";
import {
  assertDashboardWorkspaceAdminAllowed,
  createGitHubAppInstallationOctokit,
} from "./dashboard-mutations";
import { getPrisma } from "./prisma";
import { ContextProbeError, probeContextTools } from "./context-tools-probe";

async function authorize(workspaceId: string): Promise<void> {
  const actor = await assertDashboardWorkspaceAdminAllowed(workspaceId);
  // MCP credentials require durable membership, including for local operators.
  const member = await getPrisma().workspaceMember.findFirst({
    where: {
      workspaceId,
      userId: actor.userId,
      role: { in: ["owner", "admin"] },
    },
    select: { id: true },
  });
  if (!member) throw new Error("context_admin_required");
}

export async function listDashboardContextConnections(workspaceId: string) {
  await authorize(workspaceId);
  return listContextConnectionMetadata(
    workspaceId,
    new PrismaContextConnectionStore(getPrisma()),
  );
}

export async function saveDashboardContextConnection(
  input: Parameters<typeof saveContextConnection>[0],
) {
  await authorize(input.workspaceId);
  return saveContextConnection(input, {
    store: new PrismaContextConnectionStore(getPrisma()),
    crypto: { encrypt: encryptServerToken, decrypt: decryptServerToken },
  });
}

export async function assertDashboardContextSelectionAllowed(
  workspaceId: string,
  selection: ContextToolsSelection | undefined,
): Promise<void> {
  if (!selection) return;
  const connections = await listDashboardContextConnections(workspaceId);
  for (const selected of selection.mcp) {
    const connection = connections.find(
      (item) => item.id === selected.connection && item.enabled,
    );
    if (
      !connection ||
      selected.tools.some((tool) => !connection.definition.tools.includes(tool))
    ) {
      throw new ContextConnectionError("context_connection_invalid");
    }
  }
}

export function contextToolsPublicError(error: unknown): {
  error: string;
  status: number;
} {
  if (error instanceof ContextProbeError)
    return { error: error.code, status: 400 };
  if (error instanceof ContextConnectionError) {
    const allowed = [
      "context_connection_invalid",
      "context_connection_conflict",
      "context_secret_invalid",
      "context_secret_unavailable",
      "context_plan_unavailable",
      "context_github_secret_unavailable",
      "context_secret_reentry_required",
    ];
    if (allowed.includes(error.code))
      return {
        error: error.code,
        status: error.code === "context_connection_conflict" ? 409 : 400,
      };
  }
  if (
    error instanceof Error &&
    [
      "context_admin_required",
      "dashboard_auth_misconfigured",
      "dashboard_admin_requires_sign_in",
      "workspace_admin_forbidden:missing_role",
      "workspace_admin_forbidden:insufficient_role",
    ].includes(error.message)
  ) {
    return { error: "context_admin_required", status: 403 };
  }
  return { error: "context_tools_unavailable", status: 503 };
}

/** Preview only: the regular policy writer remains the sole save/CAS boundary. */
export async function importDashboardContextSelection(
  workspaceId: string,
  repositoryId: string,
): Promise<{ selection: ContextToolsSelection; sourceCommit: string }> {
  await authorize(workspaceId);
  const repository = await getPrisma().repositoryConnection.findFirst({
    where: {
      id: repositoryId,
      workspaceId,
      provider: "github",
      sourceBaseUrl: "https://github.com",
      selected: true,
      archived: false,
      workspace: { deletionState: "active" },
      installation: { workspaceId, status: "active" },
    },
    select: {
      owner: true,
      name: true,
      defaultBranch: true,
      githubRepositoryId: true,
      installation: { select: { githubInstallationId: true } },
    },
  });
  const invalid = () =>
    new ContextConnectionError("context_connection_invalid");
  if (
    !repository?.installation ||
    !repository.githubRepositoryId ||
    !repository.defaultBranch
  )
    throw invalid();
  const octokit = await createGitHubAppInstallationOctokit(
    String(repository.installation.githubInstallationId),
  );
  const identity = await octokit.request("GET /repos/{owner}/{repo}", {
    owner: repository.owner,
    repo: repository.name,
  });
  const observed = z
    .object({
      id: z.number().int().positive().safe(),
      name: z.string(),
      owner: z.object({ login: z.string() }),
      default_branch: z.string().min(1),
      archived: z.literal(false),
    })
    .safeParse(identity.data);
  if (
    !observed.success ||
    String(observed.data.id) !== String(repository.githubRepositoryId) ||
    observed.data.owner.login.toLowerCase() !==
      repository.owner.toLowerCase() ||
    observed.data.name.toLowerCase() !== repository.name.toLowerCase() ||
    observed.data.default_branch !== repository.defaultBranch
  )
    throw invalid();
  const ref = await octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
    owner: repository.owner,
    repo: repository.name,
    ref: `heads/${repository.defaultBranch}`,
  });
  const head = z
    .object({
      ref: z.string(),
      object: z.object({
        type: z.literal("commit"),
        sha: z.string().regex(/^[a-f0-9]{40}$/),
      }),
    })
    .safeParse(ref.data);
  if (
    !head.success ||
    head.data.ref !== `refs/heads/${repository.defaultBranch}`
  )
    throw invalid();
  const sourceCommit = head.data.object.sha;
  const content = await octokit.request(
    "GET /repos/{owner}/{repo}/contents/{path}",
    {
      owner: repository.owner,
      repo: repository.name,
      path: ".reviewrouter.json",
      ref: sourceCommit,
    },
  );
  const blob = z
    .object({
      type: z.literal("file"),
      path: z.literal(".reviewrouter.json"),
      encoding: z.literal("base64"),
      size: z.number().int().min(1).max(32768),
      content: z.string().max(45000),
      sha: z.string().regex(/^[a-f0-9]{40}$/),
    })
    .safeParse(content.data);
  if (!blob.success) throw invalid();
  const encoded = blob.data.content.replace(/\s+/g, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw invalid();
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length !== blob.data.size ||
    bytes.length > 32768 ||
    createHash("sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex") !== blob.data.sha
  )
    throw invalid();
  let project: unknown;
  try {
    project = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw invalid();
  }
  const parsed = z
    .object({ contextTools: contextToolsSelectionSchema })
    .safeParse(project);
  if (!parsed.success) throw invalid();
  await assertDashboardContextSelectionAllowed(
    workspaceId,
    parsed.data.contextTools,
  );
  return { selection: parsed.data.contextTools, sourceCommit };
}

/** Workflow bindings contain exact GitHub secret names only, never values. */
export async function contextToolsWorkflowSecrets(
  workspaceId: string,
  selection: ContextToolsSelection | undefined,
): Promise<Readonly<Record<string, string>> | undefined> {
  if (!selection) return undefined;
  const parsed = contextToolsSelectionSchema.safeParse(selection);
  if (!parsed.success)
    throw new ContextConnectionError("context_connection_invalid");
  if (!parsed.data.builtinTools.length && !parsed.data.mcp.length)
    return undefined;
  const connections = await listDashboardContextConnections(workspaceId);
  try {
    const plan = captureContextToolsPlan(
      parsed.data,
      connections.map((connection) => ({
        workspaceId,
        version: connection.version,
        enabled: connection.enabled,
        definition: connection.definition,
        encryptedSecrets: null,
      })),
    );
    const entries = plan.servers.flatMap((server) =>
      Object.entries(server.credentials).flatMap(([name, binding]) =>
        binding.source === "github-secret"
          ? [[name, binding.name] as const]
          : [],
      ),
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  } catch {
    throw new ContextConnectionError("context_connection_invalid");
  }
}

/** Authorize before storage, decryption, DNS or any remote request. Tests never save a connection. */
export async function testDashboardContextConnection(
  input: ContextConnectionProbeInput,
) {
  await authorize(input.workspaceId);
  const prepared = await prepareContextConnectionProbe(input, {
    store: new PrismaContextConnectionStore(getPrisma()),
    crypto: { encrypt: encryptServerToken, decrypt: decryptServerToken },
  });
  return { ok: true as const, tools: await probeContextTools(prepared) };
}
