import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { test } from "node:test";
import { createNewtestContextGateway } from "./rr-v4-one-shot-NEWTEST-gateway.ts";
import { canonicalJson } from "../packages/features/review-investigations/src/domain/canonicalization.js";

// Valid raw Git objects, not a runtime/registration/authentication qualification.
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture({ text = "real bounded bytes\n", mode = "100644" } = {}) {
  const objects = new Map();
  const calls = [];
  function save(kind, content) {
    const bytes = Buffer.from(content);
    const id = createHash("sha1")
      .update(`${kind} ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    objects.set(`${kind}:${id}`, bytes);
    return id;
  }
  const baseBlob = save("blob", "old bytes\n");
  const headBlob = save("blob", text);
  const makeTree = (blob) =>
    save(
      "tree",
      Buffer.concat([
        Buffer.from(`${mode} example.ts\0`),
        Buffer.from(blob, "hex"),
      ]),
    );
  const baseTree = makeTree(baseBlob);
  const headTree = makeTree(headBlob);
  const baseCommit = save("commit", `tree ${baseTree}\n\nNEWTEST-base\n`);
  const headCommit = save("commit", `tree ${headTree}\n\nNEWTEST-head\n`);
  const secret = Buffer.alloc(32, 7);
  const sourceHash = "a".repeat(64);
  const input = {
    repositoryGitHubId: "1252762369",
    gatewaySessionSecret: secret,
    allowedPaths: ["example.ts"],
    measuredGatewayEntrypointSha256: sourceHash,
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
        headSha: headCommit,
        mergeBaseSha: baseCommit,
        checkoutTreeOid: headTree,
      },
    },
    objects: {
      read: async (kind, id) => {
        calls.push(`${kind}:${id}`);
        const bytes = objects.get(`${kind}:${id}`);
        assert(bytes, "unexpected object request");
        return bytes;
      },
    },
  };
  return {
    input,
    calls,
    objects,
    headBlob,
    baseBlob,
    headTree,
    baseTree,
    secret,
  };
}

test("actual object bytes produce full inventory/file identities and server-contract HMAC/replay", async () => {
  const f = fixture();
  const gateway = await createNewtestContextGateway(f.input);
  const inventory = gateway.inventory();
  assert.equal(inventory.items.length, 1);
  assert.equal(inventory.items[0].path, "example.ts");
  const read = await gateway.readFile("example.ts");
  assert.equal(read.text, "real bounded bytes\n");
  assert.equal(read.result.blobOid, f.headBlob);
  assert.equal(read.result.treeOid, f.headTree);
  assert.equal(read.result.contentHash, hash(Buffer.from(read.text)));
  assert.equal(read.result.byteCount, Buffer.byteLength(read.text));
  assert.equal(read.result.lineCount, 1);
  const sealed = gateway.finish();
  const manifest = JSON.parse(sealed.transcriptCanonicalJson);
  const replay = JSON.parse(sealed.replayMaterialCanonicalJson);
  assert.equal(sealed.transcriptHash, hash(sealed.transcriptCanonicalJson));
  assert.equal(
    sealed.replayMaterialHash,
    hash(sealed.replayMaterialCanonicalJson),
  );
  assert.equal(replay.replayMaterialVersion, 2);
  assert.equal(replay.sessionId, "NEWTEST-session");
  assert.equal(manifest.events.length, 2);
  let previous = f.input.session.eventChainSeedHash;
  for (const event of manifest.events) {
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
    const entry = replay.entries[event.sequence - 1];
    assert.equal(entry.operationReceiptId, event.operationReceiptId);
    const replayInput =
      event.operationKind === "canonical_inventory"
        ? { ...entry.replayInput, cursor: null }
        : entry.replayInput;
    assert.equal(
      event.operationKey,
      hash(
        canonicalJson({
          kind: event.operationKind,
          inputHash: hash(canonicalJson(replayInput)),
        }),
      ),
    );
  }
  assert.equal(manifest.authenticatedChainHash, previous);
  assert.throws(() => gateway.finish(), /closed_or_expired/);
  assert.deepEqual(f.secret, Buffer.alloc(32, 7)); // Caller-owned secret is not mutated.
});

test("replacement/tampered object bytes cannot yield a success receipt", async () => {
  const f = fixture();
  f.objects.set(`blob:${f.headBlob}`, Buffer.from("tampered"));
  const gateway = await createNewtestContextGateway(f.input);
  await assert.rejects(gateway.readFile("example.ts"), /file_read_denied/);
  assert.throws(() => gateway.finish(), /closed_or_expired/);
});

test("only actual registered artifact/session pins admit the executor", async () => {
  for (const changed of [
    { measuredGatewayEntrypointSha256: "c".repeat(64) },
    {
      session: {
        ...fixture().input.session,
        sourceLeaseAuthorityKind: "standard_execution",
      },
    },
    { session: { ...fixture().input.session, eventCount: 1 } },
    {
      registeredRelease: {
        ...fixture().input.registeredRelease,
        state: "revoked",
      },
    },
  ]) {
    const f = fixture();
    await assert.rejects(
      createNewtestContextGateway({ ...f.input, ...changed }),
      /admission_denied/,
    );
    assert.equal(f.calls.length, 0);
  }
});

test("symlink/gitlink inventory and binary/LFS/traversal reads fail closed", async () => {
  for (const mode of ["120000", "160000"]) {
    const f = fixture({ mode });
    await assert.rejects(
      createNewtestContextGateway(f.input),
      /file_mode_unsupported/,
    );
  }
  for (const text of [
    "\0secret",
    "version https://git-lfs.github.com/spec/v1\noid sha256:x\n",
    "ordinary text",
  ]) {
    const f = fixture({ text });
    const gateway = await createNewtestContextGateway(f.input);
    await assert.rejects(
      gateway.readFile(
        text === "ordinary text" ? "../example.ts" : "example.ts",
      ),
      /file_read_denied/,
    );
    assert.throws(() => gateway.finish(), /closed_or_expired/);
  }
});

test("merge-base read binds exact authorized old tree/blob, never head bytes", async () => {
  const f = fixture();
  const gateway = await createNewtestContextGateway(f.input);
  const read = await gateway.readFile("example.ts", "merge_base");
  assert.equal(read.text, "old bytes\n");
  assert.equal(read.result.blobOid, f.baseBlob);
  assert.equal(read.result.treeOid, f.baseTree);
  assert.equal(read.result.revision, "merge_base");
  const sealed = gateway.finish();
  assert.equal(
    JSON.parse(sealed.replayMaterialCanonicalJson).entries[0].replayInput
      .revision,
    "merge_base",
  );
});

test("in-flight read cannot be sealed as a complete transcript", async () => {
  const f = fixture();
  const read = f.input.objects.read;
  let settle;
  f.input.objects.read = async (kind, id) => {
    if (kind === "blob")
      await new Promise((resolve) => {
        settle = resolve;
      });
    return read(kind, id);
  };
  const gateway = await createNewtestContextGateway(f.input);
  gateway.inventory();
  const pending = gateway.readFile("example.ts");
  assert.throws(() => gateway.finish(), /reads_incomplete/);
  settle();
  await assert.rejects(pending, /file_read_denied/);
  assert.throws(() => gateway.finish(), /closed_or_expired/);
});
