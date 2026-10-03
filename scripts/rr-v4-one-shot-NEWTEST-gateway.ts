import { createHash, createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  canonicalContextGatewayV4Manifest,
  createContextGatewayV4Manifest,
  type ContextGatewayV4Event,
} from "../packages/features/review-context-attestation/src/domain/context-gateway-v4-manifest.js";
import type { GatewaySession } from "../packages/features/review-context-attestation/src/domain/gateway-session.js";
import type { ProducerRelease } from "../packages/features/review-run-control/src/domain/producer-release.js";
import { canonicalJson } from "../packages/features/review-investigations/src/domain/canonicalization.js";

const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const oid = (kind: string, value: Uint8Array) =>
  createHash("sha1")
    .update(`${kind} ${value.length}\0`)
    .update(value)
    .digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });
function assert(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(reason);
}
function pathParts(path: string): string[] {
  assert(
    path.length > 0 &&
      path.length <= 512 &&
      path.normalize("NFC") === path &&
      !/[\x00-\x1f\x7f\\]/u.test(path),
    "newtest_gateway_path_invalid",
  );
  const parts = path.split("/");
  assert(
    parts.every(
      (part) => part && part !== "." && part !== ".." && part !== ".git",
    ),
    "newtest_gateway_path_invalid",
  );
  return parts;
}
export type GitObjectKind = "commit" | "tree" | "blob";
export interface ImmutableGitObjects {
  read(kind: GitObjectKind, objectId: string): Promise<Uint8Array>;
}

/** Actual local immutable-object reader. No shell, checkout, network, filters,
 * rev parsing, refs, index or working-tree reads. Only bounded cat-file by exact
 * OID; every returned commit/tree/blob is independently hash-verified below.
 * Construction is import-only; qualification/read run only when explicitly called. */
export function createNewtestGitObjects(input: {
  gitDir: string;
  gitBinary: string;
  repositoryGitHubId: "1252762369";
}): ImmutableGitObjects {
  assert(
    input.repositoryGitHubId === "1252762369" &&
      isAbsolute(input.gitDir) &&
      isAbsolute(input.gitBinary),
    "newtest_gateway_checkout_denied",
  );
  let qualified: Promise<void> | undefined;
  let calls = 0;
  async function qualify() {
    assert(
      (await realpath(input.gitDir)) === input.gitDir,
      "newtest_gateway_checkout_symlink",
    );
    for (const target of [input.gitDir, join(input.gitDir, "objects")])
      assert(
        (await lstat(target)).isDirectory(),
        "newtest_gateway_checkout_invalid",
      );
    // A caller-created disposable configless object snapshot is required.
    // Never read a clone's remote/auth configuration or its include directives.
    for (const target of [
      join(input.gitDir, "config"),
      join(input.gitDir, "commondir"),
      join(input.gitDir, "objects", "info", "alternates"),
      join(input.gitDir, "objects", "info", "http-alternates"),
    ]) {
      let absent = false;
      try {
        await lstat(target);
      } catch (error) {
        absent = (error as NodeJS.ErrnoException).code === "ENOENT";
      }
      assert(absent, "newtest_gateway_external_git_configuration_denied");
    }
    assert(
      (await lstat(join(input.gitDir, "HEAD"))).isFile(),
      "newtest_gateway_head_invalid",
    );
    for (const target of [
      join(input.gitDir, "objects", "info"),
      join(input.gitDir, "objects", "pack"),
    ]) {
      try {
        assert(
          (await lstat(target)).isDirectory(),
          "newtest_gateway_object_directory_invalid",
        );
        const names = await readdir(target);
        assert(names.length <= 32, "newtest_gateway_pack_budget_exceeded");
        for (const name of names)
          assert(
            (await lstat(join(target, name))).isFile(),
            "newtest_gateway_object_symlink_denied",
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return {
    async read(kind, objectId) {
      assert(
        ["commit", "tree", "blob"].includes(kind) &&
          /^[a-f0-9]{40}$/.test(objectId),
        "newtest_gateway_git_object_invalid",
      );
      assert(++calls <= 256, "newtest_gateway_object_budget_exceeded");
      await (qualified ??= qualify());
      try {
        assert(
          (
            await lstat(join(input.gitDir, "objects", objectId.slice(0, 2)))
          ).isDirectory(),
          "newtest_gateway_object_symlink_denied",
        );
        assert(
          (
            await lstat(
              join(
                input.gitDir,
                "objects",
                objectId.slice(0, 2),
                objectId.slice(2),
              ),
            )
          ).isFile(),
          "newtest_gateway_object_symlink_denied",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const bytes = await new Promise<Buffer>((resolve, reject) => {
        execFile(
          input.gitBinary,
          [
            "--no-replace-objects",
            "--no-optional-locks",
            `--git-dir=${input.gitDir}`,
            "-c",
            "core.fsmonitor=false",
            "cat-file",
            kind,
            objectId,
          ],
          {
            encoding: "buffer",
            maxBuffer: 1_000_000,
            timeout: 5_000,
            env: {
              PATH: "/usr/bin:/bin",
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_CONFIG_GLOBAL: "/dev/null",
              GIT_CONFIG_SYSTEM: "/dev/null",
              GIT_NO_REPLACE_OBJECTS: "1",
              GIT_OPTIONAL_LOCKS: "0",
              GIT_TERMINAL_PROMPT: "0",
            },
          },
          (error, stdout) =>
            error
              ? reject(new Error("newtest_gateway_git_read_failed"))
              : resolve(stdout),
        );
      });
      assert(
        oid(kind, bytes) === objectId,
        "newtest_gateway_git_object_hash_mismatch",
      );
      return bytes;
    },
  };
}

type Entry = { mode: string; name: string; oid: string };
function entries(bytes: Uint8Array): Entry[] {
  const b = Buffer.from(bytes);
  const result: Entry[] = [];
  let offset = 0;
  while (offset < b.length) {
    const space = b.indexOf(32, offset);
    const nul = b.indexOf(0, space + 1);
    assert(
      space > offset && nul > space && nul + 21 <= b.length,
      "newtest_gateway_tree_invalid",
    );
    const mode = b.subarray(offset, space).toString("ascii");
    const name = utf8.decode(b.subarray(space + 1, nul));
    assert(
      pathParts(name).length === 1 && !result.some((e) => e.name === name),
      "newtest_gateway_tree_invalid",
    );
    result.push({
      mode,
      name,
      oid: b.subarray(nul + 1, nul + 21).toString("hex"),
    });
    offset = nul + 21;
  }
  return result;
}
type File = { path: string; mode: string; blobOid: string };

/** NEWTEST-only executor for complete changed-path inventory and exact-revision
 * regular UTF8 files. Unsupported/binary/LFS/symlink/gitlink/truncated inputs
 * fail closed, never produce success receipts or an 'all clear' conclusion.
 * Session/release are actual server records; secret is the genuine OPEN result.
 * The trusted launcher must measure the registered compiled artifact hash. */
export async function createNewtestContextGateway(input: {
  repositoryGitHubId: "1252762369";
  session: GatewaySession;
  gatewaySessionSecret: Uint8Array;
  registeredRelease: ProducerRelease;
  measuredGatewayEntrypointSha256: string;
  /** Actual execution assignment paths for this TEST work slot. */
  allowedPaths: readonly string[];
  objects: ImmutableGitObjects;
  now?: () => number;
}) {
  const session = structuredClone(input.session);
  const secret = Buffer.from(input.gatewaySessionSecret);
  const release = structuredClone(input.registeredRelease);
  const allowedPaths = new Set(input.allowedPaths);
  assert(
    allowedPaths.size > 0 &&
      allowedPaths.size <= 8 &&
      allowedPaths.size === input.allowedPaths.length,
    "newtest_gateway_assignment_invalid",
  );
  for (const path of allowedPaths) pathParts(path);
  const now = input.now ?? Date.now;
  assert(
    input.repositoryGitHubId === "1252762369" &&
      session.state === "opened" &&
      session.eventCount === 0 &&
      session.sourceLeaseAuthorityKind === "investigation_relay" &&
      session.gatewayPolicyVersion === "context-gateway-v4" &&
      session.gatewayPolicyVersion === release.contextGatewayPolicyVersion &&
      session.producerReleaseId === release.producerReleaseId &&
      release.state === "registered" &&
      /^[a-f0-9]{64}$/.test(input.measuredGatewayEntrypointSha256) &&
      session.gatewayBinaryHash === release.contextGatewayEntrypointDigest &&
      session.gatewayBinaryHash === input.measuredGatewayEntrypointSha256 &&
      secret.length === 32 &&
      session.expiresAtMs > now(),
    "newtest_gateway_admission_denied",
  );
  const cache = new Map<string, Uint8Array>();
  async function object(kind: GitObjectKind, id: string) {
    assert(/^[a-f0-9]{40}$/.test(id), "newtest_gateway_oid_invalid");
    const key = `${kind}:${id}`;
    let bytes = cache.get(key);
    if (!bytes) {
      bytes = new Uint8Array(await input.objects.read(kind, id));
      assert(
        bytes.length <= 1_000_000 && oid(kind, bytes) === id,
        "newtest_gateway_git_object_hash_mismatch",
      );
      cache.set(key, bytes);
      assert(cache.size <= 256, "newtest_gateway_object_budget_exceeded");
    }
    return bytes;
  }
  async function tree(commit: string) {
    const body = await object("commit", commit);
    const header = Buffer.from(body).subarray(0, 46).toString("ascii");
    assert(
      /^tree [a-f0-9]{40}\n$/.test(header),
      "newtest_gateway_commit_invalid",
    );
    return header.slice(5, 45);
  }
  const trees = {
    head: await tree(session.sourceRevision.headSha),
    merge_base: await tree(session.sourceRevision.mergeBaseSha),
  };
  assert(
    trees.head === session.sourceRevision.checkoutTreeOid,
    "newtest_gateway_checkout_tree_mismatch",
  );
  async function files(
    treeOid: string,
    prefix = "",
    depth = 0,
  ): Promise<File[]> {
    assert(depth <= 16, "newtest_gateway_tree_depth_exceeded");
    const found: File[] = [];
    for (const e of entries(await object("tree", treeOid))) {
      const path = prefix + e.name;
      pathParts(path);
      if (e.mode === "40000")
        found.push(...(await files(e.oid, `${path}/`, depth + 1)));
      else {
        assert(
          e.mode === "100644" || e.mode === "100755",
          "newtest_gateway_file_mode_unsupported",
        );
        found.push({ path, mode: e.mode, blobOid: e.oid });
      }
      assert(found.length <= 128, "newtest_gateway_inventory_budget_exceeded");
    }
    return found.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    );
  }
  const inventories = {
    head: await files(trees.head),
    merge_base: await files(trees.merge_base),
  };
  const events: ContextGatewayV4Event[] = [];
  const replay: Record<string, unknown>[] = [];
  let closed = false;
  let tainted = false;
  let inFlight = 0;
  function current() {
    assert(
      !closed && !tainted && now() < session.expiresAtMs && events.length <= 16,
      "newtest_gateway_closed_or_expired",
    );
  }
  function record(
    kind: "file_read" | "canonical_inventory",
    rawInput: Record<string, unknown>,
    result: Record<string, unknown>,
  ) {
    current();
    assert(events.length < 16, "newtest_gateway_event_budget_exceeded");
    const replayInput = structuredClone(rawInput);
    const hashedInput =
      kind === "canonical_inventory"
        ? { ...replayInput, cursor: null }
        : replayInput;
    const operation = { kind, inputHash: sha(canonicalJson(hashedInput)) };
    const operationKey = sha(canonicalJson(operation));
    const sequence = events.length + 1;
    const operationReceiptId = sha(
      canonicalJson({
        domain: "rr.newtest.gateway.receipt.v1",
        sessionId: session.sessionId,
        sequence,
        operationKey,
        result,
      }),
    );
    const previousEventHash =
      events.at(-1)?.eventHash ?? session.eventChainSeedHash;
    const event = {
      sequence,
      previousEventHash,
      operationKey,
      operationKind: kind,
      outcome: "succeeded",
      failureClass: null,
      operation,
      result,
      operationReceiptId,
      sanitizedReason: null,
    };
    const eventHash = createHmac("sha256", secret)
      .update(
        canonicalJson({
          sessionId: session.sessionId,
          sequence,
          previousEventHash,
          operationKey,
          outcome: event.outcome,
          failureClass: null,
          operation,
          result,
          operationReceiptId,
          sanitizedReason: null,
        }),
      )
      .digest("hex");
    events.push({ ...event, eventHash } as ContextGatewayV4Event);
    replay.push({
      sequence,
      operationReceiptId,
      operationKey,
      operationKind: kind,
      replayInput,
    });
    return { operationReceiptId, operationKey, result };
  }
  return {
    inventory() {
      try {
        current();
        const before = new Map(inventories.merge_base.map((f) => [f.path, f]));
        const after = new Map(inventories.head.map((f) => [f.path, f]));
        const items = [...new Set([...before.keys(), ...after.keys()])]
          .sort()
          .filter(
            (path) =>
              before.get(path)?.blobOid !== after.get(path)?.blobOid ||
              before.get(path)?.mode !== after.get(path)?.mode,
          )
          .map((path) => ({
            path,
            before: before.get(path) ?? null,
            after: after.get(path) ?? null,
          }));
        assert(
          items.length > 0 && items.length <= 8,
          "newtest_gateway_changed_path_budget_exceeded",
        );
        const pathHashes = items.map((item) => sha(item.path));
        const input = { cursor: null, pageSize: 128 };
        const result = {
          treeOid: trees.head,
          queryDigest: sha(canonicalJson(input)),
          pageItemsHash: sha(canonicalJson(items)),
          pageOrdinal: 0,
          pageItemCount: items.length,
          pagePathHashes: pathHashes,
          cursorInputHash: null,
          nextCursorHash: null,
          complete: true,
          aggregateHash: sha(canonicalJson(items)),
          aggregateItemCount: items.length,
          aggregatePathCount: items.length,
          aggregatePathSetHash: sha(canonicalJson([...pathHashes].sort())),
        };
        return { ...record("canonical_inventory", input, result), items };
      } catch {
        tainted = true;
        throw new Error("newtest_gateway_inventory_denied");
      }
    },
    async readFile(path: string, revision: "head" | "merge_base" = "head") {
      inFlight++;
      try {
        current();
        pathParts(path);
        assert(
          allowedPaths.has(path),
          "newtest_gateway_file_outside_assignment",
        );
        assert(
          revision === "head" || revision === "merge_base",
          "newtest_gateway_revision_invalid",
        );
        const file = inventories[revision].find((f) => f.path === path);
        assert(file, "newtest_gateway_file_missing");
        const bytes = await object("blob", file.blobOid);
        const text = utf8.decode(bytes);
        assert(
          !text.includes("\0") &&
            !text.startsWith("version https://git-lfs.github.com/spec/v1"),
          "newtest_gateway_binary_or_lfs_denied",
        );
        const result = {
          revision,
          treeOid: trees[revision],
          pathHash: sha(path),
          mode: file.mode,
          blobOid: file.blobOid,
          contentHash: sha(bytes),
          contentKind: "text",
          lineCount:
            text.length === 0
              ? 0
              : text.split("\n").length - (text.endsWith("\n") ? 1 : 0),
          startByte: 0,
          byteCount: bytes.length,
          eof: true,
          complete: true,
        };
        return {
          ...record(
            "file_read",
            { revision, path, startByte: 0, maxBytes: 1_000_000 },
            result,
          ),
          text,
        };
      } catch {
        tainted = true;
        throw new Error("newtest_gateway_file_read_denied");
      } finally {
        inFlight--;
      }
    },
    finish() {
      current();
      if (inFlight !== 0) {
        tainted = true;
        throw new Error("newtest_gateway_reads_incomplete");
      }
      assert(events.length > 0, "newtest_gateway_no_evidence");
      closed = true;
      const manifest = createContextGatewayV4Manifest({
        manifestVersion: 3,
        gatewayPolicyVersion: session.gatewayPolicyVersion,
        gatewayBinaryHash: session.gatewayBinaryHash,
        checkoutTreeOid: trees.head,
        eventChainSeedHash: session.eventChainSeedHash,
        authenticatedChainHash: events.at(-1)!.eventHash,
        complete: true,
        confinementTainted: false,
        terminalFailureClass: null,
        events,
      });
      const transcriptCanonicalJson =
        canonicalContextGatewayV4Manifest(manifest);
      const replayMaterialCanonicalJson = canonicalJson({
        replayMaterialVersion: 2,
        sessionId: session.sessionId,
        entries: replay,
      });
      secret.fill(0);
      return {
        transcriptCanonicalJson,
        transcriptHash: sha(transcriptCanonicalJson),
        replayMaterialCanonicalJson,
        replayMaterialHash: sha(replayMaterialCanonicalJson),
      };
    },
  };
}
