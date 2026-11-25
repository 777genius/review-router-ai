import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

interface SourceFile {
  path: string;
  content: string;
  mode: string;
  gitBlob: string;
  sha256: string;
  bytes: number;
}
interface Pack {
  kind: string;
  repository: string;
  preparedTree: string;
  main: string;
  priorMain: string;
  provider: string;
  normalLockSHA256: string;
  normalLockGitBlob: string;
  parentLocks: { mainSHA256: string; providerSHA256: string };
  preservedMainFiles: { path: string; gitBlob: string }[];
  bundleSeeds: { path: string; from: string; gitBlob: string; sha256: string }[];
  expectedConflicts: string[];
  files: SourceFile[];
}
const EXPECTED_PACK_SHA256 = "665a5130df79eb2844142d31388eaccbe8f03f7f7607ee035c20c24c55bbacc9";
const EXPECTED_TREE = "8744ecf9b32dc137fb6908179e8b387930ccfa94";
const MAIN = "919a5add21a40d9adee064bf23b2e4217bd7e040";
const PRIOR_MAIN = "0fd865b6dd132aaae6004e74ddf09b60bb64eb17";
const PROVIDER = "98228d9f58c476b6faba34324af9841e28e3f530";
const EXPECTED_LOCK = "846ce11ee521178a0e640d8c0ed70fe83959b560af2d97a9b0936e4c367d51ed";
const EXPECTED_LOCK_BLOB = "c1d88ed4a303545306a586597df2f8961607c29e";
assert.equal(process.version, "v26.11.1", "source reconstruction requires pinned Node26.11.1");
const args = process.argv.slice(2);
assert.equal(args.length, 4, "usage: reconstruct-provider-source.ts prepare|seal PRODUCT_ROOT SOURCE_FILES_JSON RECEIPT_JSON");
const [phase, suppliedRoot, suppliedPack, suppliedReceipt] = args;
assert.ok(phase === "prepare" || phase === "seal", "invalid phase");
assert.ok(suppliedRoot && suppliedPack && suppliedReceipt);
const root = realpathSync(suppliedRoot);
const packPath = realpathSync(suppliedPack);
const receiptPath = resolve(suppliedReceipt);
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function gitBlob(content: string | Buffer): string {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function inside(path: string): boolean {
  const local = relative(root, path);
  return local === "" || (!isAbsolute(local) && local !== ".." && !local.startsWith(".." + sep));
}
assert.ok(!inside(packPath) && !inside(receiptPath), "pack and receipts must be outside product checkout");
assert.ok(!inside(fileURLToPath(import.meta.url)), "helper must be outside product checkout");
const packBytes = readFileSync(packPath);
assert.equal(sha256(packBytes), EXPECTED_PACK_SHA256, "immutable reconstruction pack mismatch");
const pack = JSON.parse(packBytes.toString("utf8")) as Pack;
assert.equal(pack.kind, "reviewrouter-native-source-reconstruction/v1");
assert.equal(pack.repository, "777genius/review-router-ai");
assert.equal(pack.preparedTree, EXPECTED_TREE);
assert.equal(pack.main, MAIN);
assert.equal(pack.priorMain, PRIOR_MAIN);
assert.equal(pack.provider, PROVIDER);
assert.equal(pack.normalLockSHA256, EXPECTED_LOCK);
assert.equal(pack.normalLockGitBlob, EXPECTED_LOCK_BLOB);
assert.equal(pack.files.length, 14);
assert.equal(new Set(pack.files.map((file) => file.path)).size, 14);
const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
function callGit(gitArgs: readonly string[]) {
  return spawnSync("git", ["-C", root, ...gitArgs], {
    encoding: "utf8",
    env: gitEnv,
    maxBuffer: 64 * 1024 * 1024,
  });
}
function git(...gitArgs: string[]): string {
  const result = callGit(gitArgs);
  if (result.status !== 0) {
    throw new Error("git " + gitArgs.join(" ") + " failed: " + result.stderr);
  }
  return result.stdout;
}
function lines(text: string): string[] {
  return text.trim() === "" ? [] : text.trimEnd().split("\n");
}
function sourcePath(path: string): string {
  assert.ok(path !== "" && !isAbsolute(path), "invalid source path");
  const target = resolve(root, path);
  assert.ok(inside(target) && target !== root, "source path escapes product checkout");
  for (let component = target; component !== root; component = dirname(component)) {
    if (existsSync(component)) {
      assert.equal(lstatSync(component).isSymbolicLink(), false, "symlink in source path " + path);
    }
  }
  return target;
}
function writeSource(path: string, content: string): void {
  const target = sourcePath(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { encoding: "utf8", mode: 0o644 });
  chmodSync(target, 0o644);
}
function sourceSnapshot() {
  return pack.files.map((file) => {
    const bytes = readFileSync(sourcePath(file.path));
    return { path: file.path, gitBlob: gitBlob(bytes), sha256: sha256(bytes), bytes: bytes.length };
  });
}
function assertResolvedFiles(): void {
  for (const file of pack.files) {
    assert.equal(file.mode, "100644");
    assert.equal(gitBlob(file.content), file.gitBlob, "pack blob mismatch " + file.path);
    assert.equal(sha256(file.content), file.sha256, "pack SHA256 mismatch " + file.path);
    const bytes = readFileSync(sourcePath(file.path));
    assert.equal(bytes.length, file.bytes, "source length changed " + file.path);
    assert.equal(gitBlob(bytes), file.gitBlob, "source blob changed " + file.path);
    assert.equal(sha256(bytes), file.sha256, "source SHA256 changed " + file.path);
    assert.equal(git("rev-parse", ":" + file.path).trim(), file.gitBlob, "index source changed " + file.path);
  }
}
function assertMainFiles(): void {
  const expected = pack.preservedMainFiles.map((file) => file.path).sort();
  assert.deepEqual(lines(git("diff", "--name-only", PRIOR_MAIN, MAIN)).sort(), expected, "unexpected pinned main delta");
  for (const file of pack.preservedMainFiles) {
    assert.equal(git("rev-parse", MAIN + ":" + file.path).trim(), file.gitBlob, "main blob mismatch " + file.path);
    assert.equal(gitBlob(readFileSync(sourcePath(file.path))), file.gitBlob, "lost main bytes " + file.path);
    assert.equal(git("rev-parse", ":" + file.path).trim(), file.gitBlob, "lost staged main bytes " + file.path);
  }
}
function assertSeedBundles(): void {
  for (const seed of pack.bundleSeeds) {
    assert.equal(git("rev-parse", seed.from + ":" + seed.path).trim(), seed.gitBlob, "parent bundle seed mismatch");
    const bytes = readFileSync(sourcePath(seed.path));
    assert.equal(gitBlob(bytes), seed.gitBlob, "bundle changed before hosted build " + seed.path);
    assert.equal(sha256(bytes), seed.sha256, "bundle SHA256 mismatch " + seed.path);
    assert.equal(git("rev-parse", ":" + seed.path).trim(), seed.gitBlob, "index bundle seed mismatch");
  }
}
function writeReceipt(value: unknown): void {
  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, JSON.stringify(value, null, 2) + "\n");
}
function baseReceipt(status: string) {
  return {
    kind: "reviewrouter-native-source-reconstruction-receipt/v1",
    status,
    phase,
    head: git("rev-parse", "HEAD").trim(),
    intendedFinalParents: [PROVIDER, MAIN],
    mainTree: git("rev-parse", MAIN + "^{tree}").trim(),
    expectedPreparedTree: EXPECTED_TREE,
    expectedLockSHA256: EXPECTED_LOCK,
    packSHA256: EXPECTED_PACK_SHA256,
    runtime: "UNQUALIFIED; normal hosted frozen lifecycle, Prisma generation and both bundle rebuild/parity remain mandatory",
  };
}
try {
  assert.equal(git("rev-parse", "HEAD").trim(), MAIN, "product checkout must start and remain on exact main919");
  for (const commit of [MAIN, PRIOR_MAIN, PROVIDER]) git("cat-file", "-e", commit + "^{commit}");
  const mainLock = git("show", MAIN + ":pnpm-lock.yaml");
  const priorLock = git("show", PRIOR_MAIN + ":pnpm-lock.yaml");
  const providerLock = git("show", PROVIDER + ":pnpm-lock.yaml");
  assert.equal(mainLock, priorLock, "main919 dependency lock differs from reviewed main0fd");
  assert.equal(sha256(mainLock), pack.parentLocks.mainSHA256);
  assert.equal(sha256(providerLock), pack.parentLocks.providerSHA256);
  if (phase === "prepare") {
    assert.equal(git("status", "--porcelain=v1").trim(), "", "fresh disposable checkout must be clean");
    const merged = callGit(["-c", "user.name=iliya", "-c", "user.email=iliyazelenkog@gmail.com", "merge", "--no-commit", "--no-ff", PROVIDER]);
    assert.ok(merged.status === 0 || merged.status === 1, "ordinary merge failed before resolution: " + merged.stderr);
    assert.equal(git("rev-parse", "MERGE_HEAD").trim(), PROVIDER, "unexpected merge parent");
    assert.deepEqual(lines(git("diff", "--name-only", "--diff-filter=U")).sort(), pack.expectedConflicts.slice().sort(), "ordinary merge conflict set changed");
    for (const file of pack.files) {
      assert.equal(file.mode, "100644");
      assert.equal(gitBlob(file.content), file.gitBlob);
      assert.equal(sha256(file.content), file.sha256);
      writeSource(file.path, file.content);
    }
    for (const seed of pack.bundleSeeds) {
      const content = git("show", seed.from + ":" + seed.path);
      assert.equal(gitBlob(content), seed.gitBlob);
      writeSource(seed.path, content);
    }
    writeSource("pnpm-lock.yaml", mainLock);
    git("add", "--", ...pack.files.map((file) => file.path), ...pack.bundleSeeds.map((seed) => seed.path), "pnpm-lock.yaml");
    assert.equal(git("ls-files", "-u").trim(), "", "unresolved merge remains");
    assertResolvedFiles();
    assertMainFiles();
    assertSeedBundles();
    const branchLock = sourcePath("pnpm-lock.provider982.yaml");
    assert.equal(existsSync(branchLock), false, "temporary branch lock already exists");
    writeSource("pnpm-lock.provider982.yaml", providerLock);
    git("diff", "--cached", "--check", MAIN);
    const result = {
      ...baseReceipt("PREPARED_SOURCE_NEEDS_NORMAL_LOCK"),
      stagedTreeBeforeLock: git("write-tree").trim(),
      sourceFiles: sourceSnapshot(),
      parentLocks: pack.parentLocks,
      next: "Run maintained installer with --merge-git-branch-lockfiles --lockfile-only, native guard and pinned Node26.11.1/pnpm11.28.7. Then invoke seal. Never edit dependency edges manually.",
    };
    writeReceipt(result);
    console.log(JSON.stringify(result));
  } else {
    assert.equal(git("rev-parse", "MERGE_HEAD").trim(), PROVIDER, "unexpected merge parent");
    assert.equal(existsSync(sourcePath("pnpm-lock.provider982.yaml")), false, "normal parent-lock merge did not remove its temporary branch lock");
    const lock = readFileSync(sourcePath("pnpm-lock.yaml"));
    assert.equal(sha256(lock), EXPECTED_LOCK, "normal generated lock differs from previously reviewed bytes");
    assert.equal(gitBlob(lock), EXPECTED_LOCK_BLOB);
    git("add", "--", "pnpm-lock.yaml");
    assert.equal(git("ls-files", "-u").trim(), "", "unresolved merge remains");
    assert.equal(git("diff", "--name-only").trim(), "", "unstaged tracked source mutations");
    assert.equal(git("ls-files", "--others", "--exclude-standard").trim(), "", "unexpected untracked product input");
    assertResolvedFiles();
    assertMainFiles();
    assertSeedBundles();
    git("diff", "--cached", "--check", MAIN);
    const tree = git("write-tree").trim();
    assert.equal(tree, EXPECTED_TREE, "reconstructed source tree differs from previously reviewed tree");
    const changedPaths = lines(git("diff", "--cached", "--name-only", MAIN));
    assert.equal(changedPaths.length, 233, "unexpected source delta size");
    const result = {
      ...baseReceipt("EXACT_SOURCE_RECONSTRUCTION_PASS"),
      tree,
      changedPathCount: changedPaths.length,
      lockSHA256: sha256(lock),
      lockGitBlob: gitBlob(lock),
      sourceFiles: sourceSnapshot(),
      changedBlobMetadata: lines(git("diff", "--cached", "--raw", "--no-abbrev", MAIN)),
    };
    writeReceipt(result);
    console.log(JSON.stringify(result));
  }
} catch (error) {
  const raw = callGit(["diff", "--cached", "--raw", "--no-abbrev", MAIN]);
  const worktree = callGit(["status", "--short"]);
  const diagnostic = {
    kind: "reviewrouter-native-source-reconstruction-failure/v1",
    phase,
    message: error instanceof Error ? error.message : String(error),
    expectedTree: EXPECTED_TREE,
    expectedLockSHA256: EXPECTED_LOCK,
    changedBlobMetadata: raw.status === 0 ? lines(raw.stdout) : [],
    worktreeNames: worktree.status === 0 ? lines(worktree.stdout) : [],
    sourceContentsPrinted: false,
    publicationAllowed: false,
  };
  writeReceipt(diagnostic);
  console.error(JSON.stringify(diagnostic));
  process.exitCode = 1;
}
