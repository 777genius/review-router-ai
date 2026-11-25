import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const repository = "777genius/review-router-ai";
const branch = "refs/heads/work/rr959-integration-build-20261125";
const main = "919a5add21a40d9adee064bf23b2e4217bd7e040";
const provider = "98228d9f58c476b6faba34324af9841e28e3f530";
const preparedTree = "8744ecf9b32dc137fb6908179e8b387930ccfa94";
const lockSha256 = "846ce11ee521178a0e640d8c0ed70fe83959b560af2d97a9b0936e4c367d51ed";
const bundles = ["action-dist/index.cjs", "action-dist/conflict-runtime.cjs"];
const seedBundleGitBlobs = {
  "action-dist/index.cjs": "7b14386973576ed65dcded9372538f5a8c7ad408",
  "action-dist/conflict-runtime.cjs": "371734f4d860bf89e4d3af7d09daea5f9cd28bce",
};
const checks = [
  "parent-lock-merge", "frozen-install", "generated-client", "helper-typecheck",
  "conversation-source", "conversation-release", "action-typecheck",
  "action-build", "index-parity", "conflict-parity", "focused-tests",
];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function jsonObject(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  assert(record(value), "json_object_required");
  return value;
}
function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  });
}
function paths(value: string): string[] {
  return value.split("\0").filter(Boolean);
}
function safePath(path: string): void {
  assert(!isAbsolute(path) && !/[\\\u0000-\u001f]/u.test(path), "unsafe_path");
  assert(path.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "unsafe_path_segment");
  assert(!path.startsWith(".git/"), "git_metadata_path");
}
function outsideProduct(root: string, path: string): string {
  const absolute = resolve(path);
  const rel = relative(resolve(root), absolute);
  assert(rel === ".." || rel.startsWith("../") || isAbsolute(rel), "evidence_must_be_outside_product");
  return absolute;
}
function writeJson(path: string, value: unknown, maxBytes = 1024 * 1024): void {
  const body = JSON.stringify(value, null, 2) + "\n";
  assert(Buffer.byteLength(body) <= maxBytes, "receipt_size_limit");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
}
function lockIsExact(root: string): void {
  assert.equal(sha256(readFileSync(join(root, "pnpm-lock.yaml"))), lockSha256, "lock_drift");
}
function noUntracked(root: string): void {
  assert.deepEqual(paths(git(root, "ls-files", "--others", "--exclude-standard", "-z")), [], "unexpected_untracked_source");
}
function protectedManifest(root: string): string {
  const files = paths(git(root, "ls-files", "-z")).sort().filter((path) => !bundles.includes(path));
  assert(files.length > 0 && files.length < 100000, "tracked_source_count");
  const manifest = files.map((path) => {
    safePath(path);
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    assert(stat.isFile() || stat.isSymbolicLink(), "unsupported_tracked_file");
    const content = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
    return { path, kind: stat.isSymbolicLink() ? "symlink" : "file", sha256: sha256(content), size: content.length };
  });
  const body = JSON.stringify(manifest) + "\n";
  assert(Buffer.byteLength(body) <= 4 * 1024 * 1024, "source_manifest_size");
  return body;
}
function assertManifest(root: string, evidence: string): void {
  assert.equal(protectedManifest(root), readFileSync(join(evidence, "source-before.json"), "utf8"), "protected_source_drift");
}
function audit(): { guardInstalled: number; blocked: number } {
  const path = process.env.REVIEWROUTER_NATIVE_FORMAT_AUDIT;
  assert(path, "native_audit_required");
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  const entries: unknown[] = lines.map((line) => JSON.parse(line) as unknown);
  assert(entries.every(record), "invalid_native_audit");
  const guardInstalled = entries.filter((entry) => record(entry) && entry.event === "guard-installed").length;
  const blocked = entries.filter((entry) => record(entry) && entry.event === "blocked-before-initialization").length;
  assert(guardInstalled > 0 && blocked === 0, "native_guard_rejected_execution");
  return { guardInstalled, blocked };
}
function passedChecks(evidence: string): string[] {
  const lines = readFileSync(join(evidence, "checks.tsv"), "utf8").trim().split("\n");
  assert.deepEqual(lines, checks.map((name) => name + "\t0"), "required_checks_missing_or_failed");
  return checks;
}
function installedVersions(root: string): Record<string, string> {
  assert.equal(process.version, "v26.11.1", "node_version");
  const expected: Record<string, string> = {
    typescript: "7.0.2", prisma: "7.9.0", "@prisma/client": "7.9.0", "@prisma/adapter-pg": "7.9.0",
  };
  for (const [name, version] of Object.entries(expected)) {
    const manifest = jsonObject(join(root, "node_modules", name, "package.json"));
    assert(record(manifest) && manifest.version === version, "installed_version:" + name);
  }
  const manifest = jsonObject(join(root, "package.json"));
  assert.equal(manifest.packageManager, "pnpm@11.28.7", "pnpm_manifest_pin");
  const pnpm = execFileSync("pnpm", ["--version"], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(pnpm, "11.28.7", "pnpm_version");
  return { node: process.version, pnpm, ...expected };
}
function generatedClient(root: string): void {
  const require = createRequire(join(root, "package.json"));
  const client: unknown = require("@prisma/client");
  assert(record(client) && record(client.Prisma), "prisma_client_export");
  const prisma = client.Prisma;
  assert(record(prisma.prismaVersion) && prisma.prismaVersion.client === "7.9.0", "prisma_client_version");
  assert(record(prisma.ModelName), "schema_generated_client_required");
  assert.equal(prisma.ModelName.ConversationProcessing, "ConversationProcessing", "generated_conversation_model");
  assert.equal(prisma.ModelName.ProviderAccountConnection, "ProviderAccountConnection", "generated_connection_model");
}
type Entry = { path: string; mode: string; type: "blob" | "commit"; sha: string };
function treeEntries(root: string, tree: string): Map<string, Entry> {
  const entries = paths(git(root, "ls-tree", "-rz", "--full-tree", tree));
  return new Map<string, Entry>(entries.map((line): [string, Entry] => {
    const match = /^([0-9]{6}) (blob|commit) ([0-9a-f]{40})\t([\s\S]+)$/u.exec(line);
    assert(match && match[1] && match[2] && match[3] && match[4], "invalid_tree_entry");
    const [, mode, type, sha, path] = match;
    assert(mode && sha && path && (type === "blob" || type === "commit"), "invalid_tree_fields");
    safePath(path);
    return [path, { path, mode, type, sha }];
  }));
}
function changedEntries(root: string, finalTree: string): Array<Omit<Entry, "sha"> & { sha: string | null }> {
  const base = treeEntries(root, main);
  const current = treeEntries(root, finalTree);
  const entries: Array<Omit<Entry, "sha"> & { sha: string | null }> = [];
  for (const [path, old] of base) {
    if (!current.has(path)) entries.push({ ...old, sha: null });
  }
  for (const [path, entry] of current) {
    const old = base.get(path);
    if (!old || old.sha !== entry.sha || old.mode !== entry.mode || old.type !== entry.type) entries.push(entry);
  }
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  assert(entries.length > 0 && entries.length < 4096, "final_delta_count");
  return entries;
}
function validateFinal(root: string, evidence: string): string {
  const receipt = jsonObject(join(evidence, "qualification.json"));
  const finalTree = receipt.finalTree;
  assert(typeof finalTree === "string" && /^[0-9a-f]{40}$/u.test(finalTree), "final_tree_required");
  assert.equal(receipt.preparedTree, preparedTree);
  assert.equal(receipt.lockSha256, lockSha256);
  assert.equal(git(root, "write-tree").trim(), finalTree, "index_changed_after_seal");
  const changed = paths(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", preparedTree, finalTree));
  assert(changed.every((path) => bundles.includes(path)), "non_bundle_final_delta");
  git(root, "diff", "--quiet");
  noUntracked(root);
  lockIsExact(root);
  assertManifest(root, evidence);
  passedChecks(evidence);
  audit();
  return finalTree;
}
async function publish(root: string, evidence: string): Promise<void> {
  assert.equal(process.env.GITHUB_REPOSITORY, repository);
  assert.equal(process.env.GITHUB_REF, branch);
  assert.equal(process.env.GITHUB_EVENT_NAME, "push");
  const token = process.env.GITHUB_TOKEN;
  assert(token, "standard_github_token_required");
  const finalTree = validateFinal(root, evidence);
  const entries = changedEntries(root, finalTree);
  const known = new Set([
    ...treeEntries(root, main).values(), ...treeEntries(root, provider).values(),
  ].map((entry) => entry.sha));
  // Only these two immutable GitDB endpoint families are reachable.
  async function createObject(kind: "blobs" | "trees", body: Record<string, unknown>): Promise<string> {
    const response = await fetch("https://api.github.com/repos/" + repository + "/git/" + kind, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
        "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 201, "gitdb_" + kind + "_status:" + response.status);
    const value: unknown = await response.json();
    assert(record(value) && typeof value.sha === "string" && /^[0-9a-f]{40}$/u.test(value.sha), "invalid_gitdb_response");
    return value.sha;
  }
  let createdBlobs = 0;
  for (const entry of entries) {
    if (entry.sha === null || known.has(entry.sha)) continue;
    assert.equal(entry.type, "blob", "new_commit_object_forbidden");
    const content = execFileSync("git", ["-C", root, "cat-file", "blob", entry.sha], { maxBuffer: 64 * 1024 * 1024 });
    assert(content.length < 64 * 1024 * 1024, "blob_size_limit");
    const actual = await createObject("blobs", { content: content.toString("base64"), encoding: "base64" });
    assert.equal(actual, entry.sha, "uploaded_blob_identity");
    known.add(actual);
    createdBlobs += 1;
  }
  const baseTree = git(root, "rev-parse", main + "^{tree}").trim();
  const actual = await createObject("trees", { base_tree: baseTree, tree: entries });
  assert.equal(actual, finalTree, "uploaded_tree_identity");
  const result = {
    repository, main, provider, preparedTree, finalTree, lockSha256, baseTree, seedBundleGitBlobs,
    helperCommit: process.env.GITHUB_SHA, createdBlobs, entries,
    mutations: ["git/blobs", "git/trees"], commitCreated: false, refUpdated: false,
  };
  writeJson(join(evidence, "git-objects.json"), result);
  console.log("RR959_RECOVERY_GIT_OBJECTS " + JSON.stringify(result));
}
const [mode, rootArg, evidenceArg, outputArg] = process.argv.slice(2);
assert(mode && rootArg, "usage: recovery-output.ts MODE PRODUCT [EVIDENCE] [OUTPUT]");
const root = resolve(rootArg);
if (mode === "client") {
  generatedClient(root);
} else if (mode === "versions") {
  console.log(JSON.stringify(installedVersions(root)));
} else {
  assert(evidenceArg, "evidence_directory_required");
  const evidence = outsideProduct(root, evidenceArg);
  mkdirSync(evidence, { recursive: true });
  if (mode === "snapshot") {
    assert.equal(git(root, "write-tree").trim(), preparedTree, "prepared_tree_required");
    git(root, "diff", "--quiet");
    noUntracked(root);
    lockIsExact(root);
    writeFileSync(join(evidence, "source-before.json"), protectedManifest(root));
  } else if (mode === "seal") {
    assert(outputArg, "artifact_output_required");
    const output = outsideProduct(root, outputArg);
    assert.equal(git(root, "write-tree").trim(), preparedTree, "prepared_index_drift");
    assertManifest(root, evidence);
    lockIsExact(root);
    noUntracked(root);
    git(root, "diff", "--check");
    const changed = paths(git(root, "diff", "--name-only", "--no-renames", "-z"));
    assert(changed.every((path) => bundles.includes(path)), "generated_path_outside_allowlist");
    const completed = passedChecks(evidence);
    const versions = installedVersions(root);
    const nativeAudit = audit();
    git(root, "add", "--", ...bundles);
    const finalTree = git(root, "write-tree").trim();
    const delta = paths(git(root, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", preparedTree, finalTree));
    assert(delta.every((path) => bundles.includes(path)), "non_bundle_final_delta");
    git(root, "diff", "--quiet");
    const finalEntries = treeEntries(root, finalTree);
    for (const path of bundles) assert.equal(finalEntries.get(path)?.mode, "100644", "bundle_mode");
    const outputs = ["pnpm-lock.yaml", ...delta];
    const files = outputs.map((path) => {
      const absolute = join(root, path);
      const stat = lstatSync(absolute);
      assert(stat.isFile() && !stat.isSymbolicLink() && stat.size < 64 * 1024 * 1024, "invalid_artifact_file");
      const target = join(output, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(absolute, target);
      return { path, size: stat.size, sha256: sha256(readFileSync(absolute)), gitBlob: git(root, "rev-parse", finalTree + ":" + path).trim() };
    });
    const after = protectedManifest(root);
    writeFileSync(join(evidence, "source-after.json"), after);
    writeJson(join(evidence, "qualification.json"), {
      repository, main, provider, preparedTree, finalTree, lockSha256, seedBundleGitBlobs,
      helperCommit: process.env.GITHUB_SHA, versions, checks: completed,
      nativeAudit, protectedManifestSha256: sha256(after), files,
      fullPrCiStillRequired: true,
    });
    console.log("RR959_RECOVERY_QUALIFIED " + JSON.stringify({ preparedTree, finalTree, lockSha256, files }));
  } else if (mode === "publish") {
    await publish(root, evidence);
  } else {
    throw new Error("unknown_recovery_mode");
  }
}
