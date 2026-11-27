/** Fresh-process old-floor reader. The parent supplies a verified production bundle. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { PersonalCanonicalReceipt } from "../src/application/ports/personal-canonical-operation-port";
import type { RollbackReaderInput } from "./native-connection-rollback";
import {
  restrictReaderImports,
  verifyReaderRuntime,
  type ReaderRuntime,
} from "./native-connection-rollback-runtime.ts";

const specPath = process.argv[2];
assert.ok(specPath && isAbsolute(specPath));
const bytes = await readFile(specPath);
assert.ok(bytes.byteLength < 32_768);
const input = JSON.parse(bytes.toString("utf8")) as RollbackReaderInput;
assert.equal(input.contract, "rr-native-connection-old-reader/v1");
assert.equal(input.readerSHA, "38eb54a1706658fc005eba99d5c774c50005df90");
assert.equal(input.cases.length, 3);
for (const file of [
  input.bundle,
  input.client,
  input.adapter,
  input.output,
  input.runtimeManifest,
])
  assert.ok(isAbsolute(file));
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
assert.equal(digest(await readFile(input.bundle)), input.bundleSHA256);
const runtimeBytes = await readFile(input.runtimeManifest);
assert.ok(runtimeBytes.byteLength < 131_072);
assert.equal(digest(runtimeBytes), input.runtimeSHA256);
const runtime = JSON.parse(runtimeBytes.toString("utf8")) as ReaderRuntime;
assert.equal(runtime.client, input.client);
assert.equal(runtime.adapter, input.adapter);
const admittedFiles = await verifyReaderRuntime(runtime);

const require = createRequire(import.meta.url);
const { checkedDatabaseTarget } = require("./database-target.mjs") as {
  checkedDatabaseTarget: (url: string) => {
    host: string;
    port: number;
    user: string;
    database: string;
    password: () => string;
    ssl: false;
    max: number;
    options: string;
    application_name: string;
    client_encoding: string;
  };
};
const importBoundary = restrictReaderImports(
  admittedFiles,
  input.bundle,
  input.bundleSHA256,
);
let db: PrismaClientType | undefined;
try {
  const { PrismaClient } = (await import(pathToFileURL(input.client).href)) as {
    PrismaClient: typeof PrismaClientType;
  };
  const { PrismaPg } = (await import(
    pathToFileURL(input.adapter).href
  )) as typeof import("@prisma/adapter-pg");
  const { PrismaPersonalCanonicalOperations } = (await import(
    pathToFileURL(input.bundle).href
  )) as {
    PrismaPersonalCanonicalOperations: new (db: PrismaClientType) => {
      read: (actor: string, nonce: string) => Promise<PersonalCanonicalReceipt>;
    };
  };
  const target = checkedDatabaseTarget(input.databaseURL);
  assert.equal(target.user, "rr_native_rollback_reader");
  db = new PrismaClient({
    adapter: new PrismaPg({
      ...target,
      options: "-c search_path=public -c default_transaction_read_only=on",
    }),
  });
  const modes = await db.$queryRaw<
    { transaction_read_only: string }[]
  >`SHOW transaction_read_only`;
  assert.equal(modes[0]?.transaction_read_only, "on");
  const privileges = await db.$queryRaw<
    { writable: boolean }[]
  >`SELECT has_table_privilege(current_user, '"PersonalAccountOperation"', 'INSERT,UPDATE,DELETE') AS writable`;
  assert.equal(privileges[0]?.writable, false);
  const store = new PrismaPersonalCanonicalOperations(db);
  const rows = [];
  for (const entry of input.cases) {
    const receipt = await store.read(
      entry.actorUserId,
      entry.clientOperationId,
    );
    assert.equal(receipt.phase, entry.phase);
    assert.deepEqual(receipt.intent, entry.intent);
    assert.equal(digest(JSON.stringify(receipt.intent)), entry.intentSHA256);
    const persisted: { body: string; intent_hash: string }[] =
      await db.$queryRaw<
        { body: string; intent_hash: string }[]
      >`SELECT to_jsonb(op)::text AS body, op."normalizedIntentHash" AS intent_hash
      FROM "PersonalAccountOperation" op WHERE op."id" = ${receipt.id}`;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0]!.intent_hash, entry.intentSHA256);
    assert.equal(digest(persisted[0]!.body), entry.rowSHA256);
    rows.push({
      phase: receipt.phase,
      intentSHA256: entry.intentSHA256,
      rowSHA256: entry.rowSHA256,
      nativeSelectionPreserved: true,
    });
  }
  await writeFile(
    input.output,
    JSON.stringify(
      {
        contract: input.contract,
        readerSHA: input.readerSHA,
        oldReaderBuildSHA256: input.bundleSHA256,
        readOnlyTransaction: true,
        applicationWritePrivilege: false,
        rediscoveryCalls: 0,
        effects: 0,
        runtimeSHA256: input.runtimeSHA256,
        isolatedRuntimePackages: runtime.packages.length,
        runtimeModulesResolved: [...importBoundary.observed].sort(),
        rows,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
} finally {
  await db?.$disconnect();
  importBoundary.close();
}
