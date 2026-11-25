/** Read-only extraction from an immutable UAP commit; never imports or runs package code. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const registryRepository = "777genius/universal-agent-plugins-registry";
const [checkoutArgument, revisionArgument, ...options] = process.argv.slice(2);
if (
  !checkoutArgument ||
  !revisionArgument ||
  !/^[a-f0-9]{40}$/.test(revisionArgument)
) {
  throw new Error(
    "Usage: node scripts/update-mcp-catalog.ts UAP_CHECKOUT IMMUTABLE_COMMIT_SHA",
  );
}
const checkout: string = checkoutArgument;
const revision: string = revisionArgument;
const gitAt = (root: string, ...args: string[]): Buffer =>
  execFileSync("git", ["-C", root, ...args], { maxBuffer: 16 * 1024 * 1024 });
const git = (...args: string[]): Buffer => gitAt(checkout, ...args);
const packageCheckouts = new Map<string, string>([
  [registryRepository, checkout],
]);
for (const option of options) {
  if (!option.startsWith("--source=")) continue;
  const binding = option.slice("--source=".length);
  const split = binding.indexOf("=");
  if (split < 1)
    throw new Error("Expected --source=owner/repo=/absolute/checkout");
  packageCheckouts.set(binding.slice(0, split), binding.slice(split + 1));
}
if (git("rev-parse", `${revision}^{commit}`).toString().trim() !== revision)
  throw new Error("Expected exact commit");
const digest = (bytes: string | Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const read = (path: string, commit = revision): Buffer =>
  git("show", `${commit}:${path}`);

type Release = {
  components: string[];
  sequence: number;
  package_source: { repository: string; revision: string | null; path: string };
  manifest_digest: string;
  tree_digest: string;
  tree_digest_algorithm: string;
};
type Policy = {
  release_sequence: number;
  status: string;
  targets: { client: string }[];
};
type Distribution = {
  id: string;
  status: string;
  releases: Release[];
  release_policies: Policy[];
};
const directoryBytes = read("registry/directory.json");
const directory = JSON.parse(directoryBytes.toString()) as {
  schema_version: number;
  products: { id: string; default_distribution: string }[];
  distributions: Distribution[];
};
if (directory.schema_version !== 1)
  throw new Error("Unsupported Directory schema");

type PackageEntry = {
  relative: string;
  mode: string;
  kind: string;
  content: Buffer;
};
function packageEntries(source: Release["package_source"]): PackageEntry[] {
  if (source.repository !== registryRepository && !source.revision)
    throw new Error("External package requires its own immutable revision");
  const commit = source.revision ?? revision;
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository) ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    source.path
      .split("/")
      .some(
        (part) =>
          !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..",
      )
  )
    throw new Error("Invalid immutable package source");
  const root = packageCheckouts.get(source.repository);
  if (root) {
    return gitAt(root, "ls-tree", "-r", "-t", "-z", `${commit}:${source.path}`)
      .toString()
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d+) (blob|tree) ([a-f0-9]+)\t(.+)$/.exec(line);
        if (!match) throw new Error("Invalid Git tree entry");
        const [, mode, kind, , name] = match;
        if (!name || !mode || !kind) throw new Error("Invalid Git tree entry");
        return {
          relative: name,
          mode,
          kind,
          content:
            kind === "blob"
              ? gitAt(root, "show", `${commit}:${source.path}/${name}`)
              : Buffer.alloc(0),
        };
      });
  }
  if (!options.includes("--github"))
    throw new Error(
      `Supply --source=${source.repository}=/checkout or --github for immutable read-only API acquisition`,
    );
  const api = (path: string): unknown =>
    JSON.parse(
      execFileSync("gh", ["api", `repos/${source.repository}/${path}`], {
        maxBuffer: 16 * 1024 * 1024,
      }).toString(),
    );
  type Tree = {
    truncated?: boolean;
    tree: { path: string; mode: string; type: string; sha: string }[];
  };
  let treeSha = commit;
  for (const segment of source.path.split("/")) {
    const tree = api(`git/trees/${treeSha}`) as Tree;
    const next = tree.tree.find(
      (entry) => entry.path === segment && entry.type === "tree",
    );
    if (!next || tree.truncated)
      throw new Error("Missing immutable package tree");
    treeSha = next.sha;
  }
  const tree = api(`git/trees/${treeSha}?recursive=1`) as Tree;
  if (tree.truncated) throw new Error("Incomplete immutable package tree");
  return tree.tree.map((entry) => {
    const blob =
      entry.type === "blob"
        ? (api(`git/blobs/${entry.sha}`) as {
            encoding: string;
            content: string;
          })
        : null;
    if (blob && blob.encoding !== "base64")
      throw new Error("Unexpected blob encoding");
    return {
      relative: entry.path,
      mode: entry.mode,
      kind: entry.type,
      content: blob ? Buffer.from(blob.content, "base64") : Buffer.alloc(0),
    };
  });
}
function treeDigest(entries: PackageEntry[]): string {
  const hash = createHash("sha256");
  const field = (value: string | Buffer): void => {
    const bytes = Buffer.from(value);
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(length);
    hash.update(bytes);
  };
  field("agentplugins.package-tree\0sha256\0v1");
  for (const entry of entries.sort((a, b) =>
    Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)),
  )) {
    if (
      !["100644", "100755", "040000"].includes(entry.mode) ||
      !["blob", "tree"].includes(entry.kind)
    )
      throw new Error("Unsupported package tree entry");
    for (const value of [
      "entry",
      entry.relative,
      entry.kind === "blob" ? "file" : "directory",
      entry.mode,
      "",
      entry.content,
    ])
      field(value);
  }
  return `sha256:${hash.digest("hex")}`;
}

const entries = directory.products.flatMap((product) => {
  const id = product.id;
  const distribution = directory.distributions.find(
    (d) => d.id === product.default_distribution,
  );
  if (!distribution) throw new Error(`Missing default distribution: ${id}`);
  const policies = distribution.release_policies
    .filter((p) => p.status === "active")
    .sort((a, b) => b.release_sequence - a.release_sequence);
  const policy = policies[0];
  const release =
    distribution.releases.find(
      (r) => r.sequence === policy?.release_sequence,
    ) ?? distribution.releases.at(-1);
  if (!release || !release.components.includes("mcp")) return [];
  const target = policy?.targets.filter((t) => t.client === "opencode") ?? [];
  let unavailableReason: string | null = null;
  if (distribution.status !== "active" || !policy)
    unavailableReason =
      "This default distribution has no active release available for setup.";
  else if (target.length !== 1)
    unavailableReason =
      "This release has no unique OpenCode target policy. Another agent's authentication policy cannot be substituted.";
  let manifest = "";
  let mcpManifest = "";
  if (!unavailableReason) {
    const files = packageEntries(release.package_source);
    manifest =
      files
        .find((file) => file.relative === "plugin.json")
        ?.content.toString() ?? "";
    mcpManifest =
      files.find((file) => file.relative === "mcp.json")?.content.toString() ??
      "";
    if (
      !manifest ||
      !mcpManifest ||
      digest(manifest) !== release.manifest_digest ||
      release.tree_digest_algorithm !== "agentplugins-tree-sha256-v1" ||
      treeDigest(files) !== release.tree_digest
    )
      throw new Error(`Package integrity mismatch: ${id}`);
  }
  return [
    {
      product,
      distribution: { id: distribution.id, status: distribution.status },
      release,
      policy: policy ? { ...policy, targets: target } : null,
      manifest,
      mcpManifest,
      mcpManifestDigest: digest(mcpManifest),
      unavailableReason,
    },
  ];
});
const snapshot = {
  schemaVersion: 1,
  registryRepository,
  registryRevision: revision,
  directoryPath: "registry/directory.json",
  directoryDigest: digest(directoryBytes),
  entries,
};
const destination = fileURLToPath(
  new URL(
    "../apps/web/src/server/mcp-catalog-data/uap-reviewed.json",
    import.meta.url,
  ),
);
const bytes = `${JSON.stringify(snapshot, null, 2)}\n`;
if (options.includes("--check")) {
  // Compare parsed values so repository formatting is immaterial. Raw manifest
  // strings remain byte-exact values and their digests were verified above.
  if (
    JSON.stringify(JSON.parse(readFileSync(destination, "utf8"))) !==
    JSON.stringify(snapshot)
  )
    throw new Error(
      "Reviewed catalog snapshot differs from verified committed source",
    );
} else writeFileSync(destination, bytes);
console.log(
  `${options.includes("--check") ? "Verified" : "Wrote"} ${entries.length} MCP products (${entries.filter((e) => !e.unavailableReason).length} verified package trees) at ${revision}.`,
);
