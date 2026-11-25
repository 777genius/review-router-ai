import { createHash } from "node:crypto";
import { z } from "zod";
import { contextConnectionProbeDefinitionSchema } from "@reviewrouter/features-review-context-tools";
import type { McpCatalogPreset } from "../features/context-tools/mcp-catalog";
import reviewed from "./mcp-catalog-data/uap-reviewed.json";

const repository = "777genius/universal-agent-plugins-registry";
const revision = reviewed.registryRevision;
const digest = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const targetSchema = z.object({
  client: z.string(),
  authentication: z.string(),
  delivery: z.string(),
  scopes: z.array(z.string()),
});
const reviewedEntrySchema = z.object({
  product: z.object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
    display_name: z.string(),
    description: z.string(),
    default_distribution: z.string(),
  }),
  distribution: z.object({ id: z.string(), status: z.string() }),
  release: z.object({
    sequence: z.number().int().positive(),
    package_version: z.string(),
    package_source: z.object({
      repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
      revision: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .nullable(),
      path: z
        .string()
        .regex(/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
        .refine(
          (path) =>
            !path.split("/").some((part) => part === "." || part === ".."),
        ),
    }),
    tree_digest_algorithm: z.string(),
    tree_digest: z.string(),
    manifest_digest: z.string(),
  }),
  policy: z
    .object({
      release_sequence: z.number().int().positive(),
      status: z.string(),
      targets: z.array(targetSchema),
    })
    .nullable(),
  manifest: z.string(),
  mcpManifest: z.string(),
  mcpManifestDigest: z.string(),
  unavailableReason: z.string().nullable(),
});
const reviewedSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  registryRepository: z.literal(repository),
  registryRevision: z.string().regex(/^[a-f0-9]{40}$/),
  entries: z.array(reviewedEntrySchema),
});
type ReviewedEntry = z.infer<typeof reviewedEntrySchema>;
const remoteServer = z
  .object({
    type: z.literal("streamable-http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();
const mcpSchema = z
  .object({
    $schema: z.literal(
      "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    ),
    mcpServers: z.record(z.string(), z.unknown()),
  })
  .strict();

/** A release's explicit OpenCode target supplies auth policy, never another agent's target. */
export function mapReviewedMcpPreset(entry: ReviewedEntry): McpCatalogPreset {
  const target =
    entry.policy?.targets.filter((item) => item.client === "opencode") ?? [];
  const authentication = target[0]?.authentication ?? "unknown";
  const base = {
    id: entry.product.id,
    name: entry.product.display_name,
    description: entry.product.description,
    distributionId: entry.distribution.id,
    releaseSequence: entry.release.sequence,
    packageVersion: entry.release.package_version,
    catalogUrl: `https://github.com/${repository}/blob/${revision}/registry/directory.json`,
    sourceUrl: `https://github.com/${entry.release.package_source.repository}/tree/${entry.release.package_source.revision ?? revision}/${entry.release.package_source.path}`,
    targetClient: "opencode" as const,
    registryAuthentication: authentication,
  };
  const refuse = (reason: string): McpCatalogPreset => ({
    ...base,
    compatibility: { status: "unsupported", reason },
  });
  if (entry.unavailableReason) return refuse(entry.unavailableReason);
  if (!entry.policy)
    return refuse("This distribution has no active release policy.");
  if (
    entry.distribution.status !== "active" ||
    entry.product.default_distribution !== entry.distribution.id ||
    entry.policy.status !== "active" ||
    entry.policy.release_sequence !== entry.release.sequence ||
    target.length !== 1 ||
    target[0]?.delivery !== "managed" ||
    !target[0]?.scopes.includes("user") ||
    (entry.release.package_source.repository !== repository &&
      entry.release.package_source.revision === null) ||
    entry.release.tree_digest_algorithm !== "agentplugins-tree-sha256-v1" ||
    !/^sha256:[a-f0-9]{64}$/.test(entry.release.tree_digest) ||
    digest(entry.manifest) !== entry.release.manifest_digest ||
    digest(entry.mcpManifest) !== entry.mcpManifestDigest
  )
    return refuse(
      "This pinned package or release policy could not be verified.",
    );

  let manifest: unknown;
  try {
    manifest = JSON.parse(entry.mcpManifest);
  } catch {
    return refuse("The pinned MCP manifest is invalid.");
  }
  const parsed = mcpSchema.safeParse(manifest);
  if (!parsed.success || Object.keys(parsed.data.mcpServers).length !== 1) {
    return refuse(
      "This package does not define one supported remote MCP server.",
    );
  }
  const remote = remoteServer.safeParse(
    Object.values(parsed.data.mcpServers)[0],
  );
  if (!remote.success)
    return refuse(
      "Local stdio, executable launchers and other transports are not supported. Use a remote HTTPS MCP connection.",
    );
  const headers: Record<string, string> = {};
  const credentials: Record<string, { source: "dashboard-secret" }> = {};
  const originalHeaders = remote.data.headers ?? {};
  if (authentication === "not_required") {
    if (Object.keys(originalHeaders).length)
      return refuse(
        "Anonymous setup cannot include unreviewed authentication headers.",
      );
  } else if (
    authentication === "required" &&
    Object.keys(originalHeaders).length
  ) {
    // Only explicit manifest environment header placeholders can become dashboard secrets.
    // Unknown auth, OAuth and headerless required-auth packages must never become anonymous.
    for (const [name, value] of Object.entries(originalHeaders)) {
      const match = /^(Bearer )?\$\{([A-Z][A-Z0-9_]{0,63})\}$/.exec(value);
      if (!match?.[2])
        return refuse(
          "This authentication method has no supported secret header mapping. OAuth setup is not available here.",
        );
      headers[name] = `${match[1] ?? ""}{{ secrets.${match[2]} }}`;
      credentials[match[2]] = { source: "dashboard-secret" };
    }
  } else if (authentication !== "required") {
    return refuse(
      "This release has unknown authentication requirements. Setup is unavailable until its authentication policy is reviewed.",
    );
  } else {
    return refuse(
      "This package requires authentication without a supported secret header mapping. OAuth setup is not available here.",
    );
  }
  const connection = {
    id: entry.product.id.replaceAll("-", "_"),
    url: remote.data.url,
    headers,
    credentials,
  };
  if (
    !contextConnectionProbeDefinitionSchema.safeParse({
      ...connection,
      tools: [],
    }).success
  ) {
    return refuse(
      "The endpoint or header bindings do not meet ReviewRouter's HTTPS MCP connection requirements.",
    );
  }
  return {
    ...base,
    compatibility: {
      status: "supported",
      authentication: authentication === "not_required" ? "none" : "api-key",
      connection,
    },
  };
}

/** Synchronous server first paint from a reviewed snapshot; no network or installation effects. */
export function listDashboardMcpCatalogPresets(): readonly McpCatalogPreset[] {
  const parsed = reviewedSnapshotSchema.safeParse(reviewed);
  return parsed.success ? parsed.data.entries.map(mapReviewedMcpPreset) : [];
}
