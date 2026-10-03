import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import {
  createNewtestGitObjects,
  createNewtestContextGateway,
} from "./rr-v4-one-shot-NEWTEST-gateway.ts";
import { canonicalJson } from "../packages/features/review-investigations/src/domain/canonicalization.js";

// SERVER-ONLY actual subprocess qualification. Never a user-project checkout:
// every invocation uses one mkdtemp NEWTEST fixture with no config or auth.
// hash-object writes fixture objects only; no git commit or reference update.
const gitBinary = process.env.RR_NEWTEST_GIT_BINARY ?? "/usr/bin/git";
const env = {
  PATH: "/usr/bin:/bin",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
};
const sha = (value) => createHash("sha256").update(value).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "rr-v4-gateway-NEWTEST-"));
  t.after(async () => {
    assert(root.startsWith(join(tmpdir(), "rr-v4-gateway-NEWTEST-")));
    await rm(root, { recursive: true, force: true });
  });
  const gitDir = join(root, "git-objects");
  await mkdir(join(gitDir, "objects", "info"), { recursive: true });
  await mkdir(join(gitDir, "objects", "pack"), { recursive: true });
  await mkdir(join(gitDir, "refs", "heads"), { recursive: true });
  await writeFile(join(gitDir, "HEAD"), "ref: refs/heads/NEWTEST\n", {
    mode: 0o600,
  });
  function put(kind, content) {
    return execFileSync(
      gitBinary,
      [
        "--no-replace-objects",
        `--git-dir=${gitDir}`,
        "hash-object",
        "-t",
        kind,
        "-w",
        "--stdin",
      ],
      {
        input: content,
        env,
        encoding: "utf8",
        timeout: 5_000,
        maxBuffer: 1_000_000,
      },
    ).trim();
  }
  const oldBlob = put("blob", "before\n");
  const newBlob = put("blob", "actual NEWTEST bytes\n");
  const tree = (blob) =>
    put(
      "tree",
      Buffer.concat([
        Buffer.from("100644 example.ts\0"),
        Buffer.from(blob, "hex"),
      ]),
    );
  const oldTree = tree(oldBlob);
  const newTree = tree(newBlob);
  const commit = (treeId) =>
    put(
      "commit",
      `tree ${treeId}\nauthor iliya <iliyazelenkog@gmail.com> 1 +0000\ncommitter iliya <iliyazelenkog@gmail.com> 1 +0000\n\nNEWTEST immutable object fixture\n`,
    );
  const oldCommit = commit(oldTree);
  const newCommit = commit(newTree);
  const secret = Buffer.alloc(32, 9);
  const sourceHash = "a".repeat(64);
  const input = {
    repositoryGitHubId: "1252762369",
    allowedPaths: ["example.ts"],
    measuredGatewayEntrypointSha256: sourceHash,
    gatewaySessionSecret: secret,
    registeredRelease: {
      producerReleaseId: "NEWTEST-release",
      state: "registered",
      contextGatewayPolicyVersion: "context-gateway-v4",
      contextGatewayEntrypointDigest: sourceHash,
    },
    session: {
      sessionId: "NEWTEST-session",
      state: "opened",
      eventCount: 0,
      producerReleaseId: "NEWTEST-release",
      sourceLeaseAuthorityKind: "investigation_relay",
      gatewayPolicyVersion: "context-gateway-v4",
      gatewayBinaryHash: sourceHash,
      eventChainSeedHash: "b".repeat(64),
      expiresAtMs: Date.parse("2099-01-01T00:00:00.000Z"),
      sourceRevision: {
        headSha: newCommit,
        mergeBaseSha: oldCommit,
        checkoutTreeOid: newTree,
      },
    },
    objects: createNewtestGitObjects({
      gitBinary,
      gitDir,
      repositoryGitHubId: "1252762369",
    }),
  };
  return { gitDir, input, secret, oldBlob, newBlob, oldTree, newTree };
}

test("actual configless Git subprocess returns verified objects and complete authenticated evidence", async (t) => {
  const f = await fixture(t);
  const gateway = await createNewtestContextGateway(f.input);
  const inventory = gateway.inventory();
  assert.deepEqual(
    inventory.items.map((item) => item.path),
    ["example.ts"],
  );
  const head = await gateway.readFile("example.ts");
  const old = await gateway.readFile("example.ts", "merge_base");
  assert.equal(head.text, "actual NEWTEST bytes\n");
  assert.equal(head.result.blobOid, f.newBlob);
  assert.equal(old.text, "before\n");
  assert.equal(old.result.blobOid, f.oldBlob);
  assert.equal(head.result.contentHash, sha(Buffer.from(head.text)));
  assert.equal(head.result.byteCount, Buffer.byteLength(head.text));
  const sealed = gateway.finish();
  const transcript = JSON.parse(sealed.transcriptCanonicalJson);
  const replay = JSON.parse(sealed.replayMaterialCanonicalJson);
  assert.equal(transcript.events.length, 3);
  assert.equal(replay.entries.length, 3);
  assert.equal(replay.sessionId, "NEWTEST-session");
  assert.equal(sealed.transcriptHash, sha(sealed.transcriptCanonicalJson));
  assert.equal(
    sealed.replayMaterialHash,
    sha(sealed.replayMaterialCanonicalJson),
  );
  let previous = f.input.session.eventChainSeedHash;
  for (const event of transcript.events) {
    assert.equal(event.previousEventHash, previous);
    const expected = createHmac("sha256", f.secret)
      .update(
        canonicalJson({
          sessionId: "NEWTEST-session",
          sequence: event.sequence,
          previousEventHash: previous,
          operationKey: event.operationKey,
          outcome: event.outcome,
          failureClass: event.failureClass,
          operation: event.operation,
          result: event.result,
          operationReceiptId: event.operationReceiptId,
          sanitizedReason: event.sanitizedReason,
        }),
      )
      .digest("hex");
    assert.equal(event.eventHash, expected);
    previous = event.eventHash;
  }
  assert.equal(transcript.authenticatedChainHash, previous);
});

test("actual adapter rejects clone configuration and alternates before object read", async (t) => {
  for (const name of [
    "config",
    "objects/info/alternates",
    "objects/info/http-alternates",
    "commondir",
  ]) {
    const f = await fixture(t);
    await writeFile(join(f.gitDir, name), "NEWTEST denied configuration\n", {
      mode: 0o600,
    });
    await assert.rejects(
      createNewtestContextGateway(f.input),
      /external_git_configuration_denied/,
    );
  }
});

test("actual Git read cannot turn tampered loose-object bytes into a success receipt", async (t) => {
  const f = await fixture(t);
  const gateway = await createNewtestContextGateway(f.input);
  gateway.inventory();
  const bytes = Buffer.from("tampered bytes\n");
  await writeFile(
    join(f.gitDir, "objects", f.newBlob.slice(0, 2), f.newBlob.slice(2)),
    deflateSync(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])),
  );
  await assert.rejects(gateway.readFile("example.ts"), /file_read_denied/);
  assert.throws(() => gateway.finish(), /closed_or_expired/);
});
