/** Current durable writer -> exact compatible-floor production reader on fresh PostgreSQL. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaPersonalCanonicalOperations } from "../src/infrastructure/prisma/prisma-personal-canonical-operations";
import {
  canonicalIntentHash,
  type PersonalCanonicalIntent,
} from "../src/domain/personal-canonical-operation";

const floor = "38eb54a1706658fc005eba99d5c774c50005df90";
const entrypoint =
  "packages/features/provider-accounts/src/infrastructure/prisma/prisma-personal-canonical-operations.ts";
const productionFiles = [
  entrypoint,
  "packages/features/provider-accounts/src/infrastructure/prisma/prisma-personal-account-operations.ts",
  "packages/features/provider-accounts/src/infrastructure/prisma/connection-mapping.ts",
  "packages/features/provider-accounts/src/application/use-cases/personal-account-operations.ts",
  "packages/features/provider-accounts/src/domain/personal-canonical-operation.ts",
  "packages/features/provider-accounts/src/domain/native-connection.ts",
  "packages/features/provider-accounts/src/domain/provider-account.ts",
].sort();
const schemaRelative = "packages/platform/db/prisma/schema.prisma";
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
type DatabaseTarget = {
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
export type RollbackReaderInput = {
  contract: "rr-native-connection-old-reader/v1";
  readerSHA: string;
  bundle: string;
  bundleSHA256: string;
  client: string;
  adapter: string;
  databaseURL: string;
  output: string;
  cases: {
    actorUserId: string;
    clientOperationId: string;
    phase: "ready" | "submitted" | "unknown";
    intent: PersonalCanonicalIntent;
    intentSHA256: string;
    rowSHA256: string;
  }[];
};

function options() {
  const values: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i];
    const value = process.argv[i + 1];
    assert.ok(name && value && /^--[a-z-]+$/.test(name));
    assert.equal(Object.hasOwn(values, name.slice(2)), false);
    values[name.slice(2)] = value;
  }
  assert.deepEqual(Object.keys(values).sort(), [
    "database-url",
    "output",
    "reader-root",
    "reader-sha",
    "writer-root",
    "writer-sha",
  ]);
  for (const name of ["writer-root", "reader-root", "output"])
    assert.ok(isAbsolute(values[name]!));
  for (const name of ["writer-sha", "reader-sha"])
    assert.match(values[name]!, /^[a-f0-9]{40}$/);
  assert.equal(values["reader-sha"], floor);
  return values as Record<
    | "database-url"
    | "output"
    | "reader-root"
    | "reader-sha"
    | "writer-root"
    | "writer-sha",
    string
  >;
}
function cleanSource(root: string, expected: string) {
  const git = (args: string[]) =>
    execFileSync("git", ["-c", `safe.directory=${root}`, "-C", root, ...args], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
  assert.equal(git(["rev-parse", "HEAD"]), expected);
  assert.equal(
    git(["status", "--porcelain", "--untracked-files=all"]),
    "",
    "qualification requires an exact clean checkout",
  );
  return git(["rev-parse", "HEAD^{tree}"]);
}
async function treeDigest(root: string): Promise<string> {
  const files: [string, string][] = [];
  async function visit(directory: string) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      const file = join(directory, item.name);
      if (item.isDirectory()) await visit(file);
      else {
        assert.ok(
          item.isFile(),
          "qualified client tree must contain regular files only",
        );
        files.push([relative(root, file), digest(await readFile(file))]);
      }
    }
  }
  await visit(root);
  return digest(JSON.stringify(files));
}

const args = options();
assert.equal(process.version, "v26.11.1");
assert.equal(process.env.RR_PROVIDER_ACCOUNTS_DISPOSABLE_CLUSTER, "1");
assert.equal(esbuildVersion, "0.28.1");
const writerRoot = await realpath(args["writer-root"]);
const readerRoot = await realpath(args["reader-root"]);
assert.equal(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../.."),
  writerRoot,
);
const writerTree = cleanSource(writerRoot, args["writer-sha"]);
const readerTree = cleanSource(readerRoot, floor);
const require = createRequire(import.meta.url);
const guard = require("./database-target.mjs") as {
  checkedDatabaseTarget: (raw: string) => DatabaseTarget;
  assertEmptyDatabase: (client: Client) => Promise<void>;
};
const target = guard.checkedDatabaseTarget(args["database-url"]);
const output = resolve(args.output);
assert.ok(
  !output.startsWith(writerRoot + "/") && !output.startsWith(readerRoot + "/"),
);
await mkdir(output, { recursive: true });
assert.equal(
  (await readdir(output)).length,
  0,
  "qualification output must be empty so a failure cannot retain an old success receipt",
);
const temporary = await mkdtemp(join(tmpdir(), "rr-native-rollback-"));
const sql = new Client(target);
let db: PrismaClient | undefined;
try {
  const lock = await readFile(join(writerRoot, "pnpm-lock.yaml"));
  const schema = await readFile(join(writerRoot, schemaRelative));
  assert.deepEqual(await readFile(join(readerRoot, "pnpm-lock.yaml")), lock);
  assert.deepEqual(await readFile(join(readerRoot, schemaRelative)), schema);
  const clientPath = require.resolve("@prisma/client");
  const generated = dirname(
    createRequire(clientPath).resolve(".prisma/client/default"),
  );
  const generatedSchema = await readFile(join(generated, "schema.prisma"));
  const prismaPackage = require.resolve("prisma/package.json");
  const prismaMetadata = JSON.parse(await readFile(prismaPackage, "utf8")) as {
    version: string;
    bin: { prisma: string };
  };
  assert.equal(prismaMetadata.version, "7.8.0");
  const clientMetadata = JSON.parse(
    await readFile(join(dirname(clientPath), "package.json"), "utf8"),
  ) as { version: string };
  assert.equal(clientMetadata.version, "7.8.0");
  const oldSchemaCopy = join(temporary, "schema.prisma");
  await writeFile(oldSchemaCopy, schema, { mode: 0o600 });
  execFileSync(
    process.execPath,
    [
      join(dirname(prismaPackage), prismaMetadata.bin.prisma),
      "format",
      "--schema",
      oldSchemaCopy,
    ],
    {
      cwd: temporary,
      timeout: 30_000,
      env: { PATH: process.env.PATH },
      stdio: "pipe",
    },
  );
  assert.deepEqual(
    await readFile(oldSchemaCopy),
    generatedSchema,
    "pinned formatter must reproduce the installed generated schema from the old source",
  );
  const generatedClientSHA256 = await treeDigest(generated);
  const oldSources: Record<string, string> = {};
  for (const file of productionFiles)
    oldSources[file] = digest(await readFile(join(readerRoot, file)));
  const bundle = join(temporary, "old-reader.mjs");
  const compiled = await build({
    absWorkingDir: readerRoot,
    entryPoints: [entrypoint],
    outfile: bundle,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node26",
    treeShaking: false,
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "exact-old-production-reader",
        setup(builder) {
          builder.onResolve({ filter: /^@prisma\/client$/ }, () => ({
            path: clientPath,
            external: true,
          }));
          builder.onResolve({ filter: /^@reviewrouter\// }, () => ({
            errors: [
              {
                text: "old reader may not fall back to a current workspace module",
              },
            ],
          }));
          builder.onLoad({ filter: /\.ts$/ }, async (request) => {
            assert.equal(await realpath(request.path), request.path);
            assert.ok(
              productionFiles.includes(relative(readerRoot, request.path)),
            );
            return undefined;
          });
        },
      },
    ],
  });
  assert.ok(compiled.metafile);
  assert.deepEqual(
    Object.keys(compiled.metafile.inputs).sort(),
    productionFiles,
  );
  const bundleSHA256 = digest(await readFile(bundle));
  await writeFile(
    join(output, "old-reader-build.json"),
    JSON.stringify(
      {
        compatibleFloor: floor,
        readerTree,
        writerSHA: args["writer-sha"],
        writerTree,
        esbuildVersion,
        oldSources,
        bundleSHA256,
        lockfileSHA256: digest(lock),
        sourceSchemaSHA256: digest(schema),
        formattedGeneratedSchemaSHA256: digest(generatedSchema),
        generatedClientSHA256,
        inputs: compiled.metafile.inputs,
      },
      null,
      2,
    ) + "\n",
  );

  await sql.connect();
  assert.equal(
    (await sql.query<{ server_version_num: string }>("SHOW server_version_num"))
      .rows[0]?.server_version_num,
    "170010",
  );
  await guard.assertEmptyDatabase(sql);
  const migrations = join(writerRoot, "packages/platform/db/prisma/migrations");
  const names = (await readdir(migrations))
    .filter((name) => /^\d{6}_/.test(name))
    .sort();
  assert.ok(names.includes("000161_native_connection_intent"));
  for (const name of names) {
    const applied = spawnSync(
      "psql",
      [
        "-X",
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-h",
        target.host,
        "-p",
        String(target.port),
        "-U",
        target.user,
        "-d",
        target.database,
      ],
      {
        input: await readFile(join(migrations, name, "migration.sql"), "utf8"),
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH,
          PGPASSFILE: "/dev/null",
          PGSSLMODE: "disable",
          PGOPTIONS: "-c search_path=public",
        },
      },
    );
    assert.equal(applied.error, undefined);
    assert.equal(
      applied.status,
      0,
      `migration ${name} failed: ${applied.stderr}`,
    );
  }
  db = new PrismaClient({ adapter: new PrismaPg(target) });
  const store = new PrismaPersonalCanonicalOperations(db);
  const cases: RollbackReaderInput["cases"] = [];
  for (const phase of ["ready", "submitted", "unknown"] as const) {
    const suffix = randomUUID();
    const actorUserId = "rr-rollback-" + suffix;
    const personalWorkspaceId = "rr-rollback-workspace-" + suffix;
    const sourceId = "rr-rollback-source-" + suffix;
    const clientOperationId = randomUUID();
    await db.user.create({ data: { id: actorUserId } });
    await db.workspace.create({
      data: {
        id: personalWorkspaceId,
        slug: "rr-rollback-" + suffix,
        name: "Rollback fixture",
        personalOwnerUserId: actorUserId,
      },
    });
    await db.workspaceMember.create({
      data: {
        workspaceId: personalWorkspaceId,
        userId: actorUserId,
        role: "owner",
      },
    });
    await db.providerAccountConnection.create({
      data: {
        id: sourceId,
        ownerUserId: actorUserId,
        gatewayAccountRef: "rr-rollback-account-" + suffix,
        profileRef: "fixture-native-extension-responses-v1",
        displayName: "Rollback fixture",
        state: "active",
        authorizationEpochMirror: 7n,
      },
    });
    const intent: PersonalCanonicalIntent = {
      actorUserId,
      personalWorkspaceId,
      sourceId,
      clientOperationId,
      action: "reconnect",
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 4,
      expectedAuthorizationEpoch: 7,
      nativeConnection: {
        schemaVersion: 1,
        profileId: "fixture-native-extension-responses-v1",
        methodId: "fixture_browser_v1",
        methodRevision: 7,
        configurationGeneration: "rr-rollback-generation",
      },
    };
    const reserved = await store.reserve(intent);
    assert.equal(reserved.phase, "fencing");
    assert.equal(
      (await store.ready(actorUserId, clientOperationId)).phase,
      "ready",
    );
    if (phase !== "ready")
      assert.ok(await store.claim(actorUserId, clientOperationId));
    if (phase === "unknown")
      await store.notePhase(actorUserId, clientOperationId, "unknown");
    const saved = await store.read(actorUserId, clientOperationId);
    assert.equal(saved.phase, phase);
    const persisted = await sql.query<{ body: string; intent_hash: string }>(
      'SELECT to_jsonb(op)::text AS body, op."normalizedIntentHash" AS intent_hash FROM "PersonalAccountOperation" op WHERE op."id"=$1',
      [saved.id],
    );
    const intentSHA256 = canonicalIntentHash(intent);
    assert.equal(persisted.rows[0]?.intent_hash, intentSHA256);
    cases.push({
      actorUserId,
      clientOperationId,
      phase,
      intent: saved.intent,
      intentSHA256,
      rowSHA256: digest(persisted.rows[0]!.body),
    });
  }
  await sql.query(
    'CREATE ROLE rr_native_rollback_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; ALTER ROLE rr_native_rollback_reader SET default_transaction_read_only = on; GRANT USAGE ON SCHEMA public TO rr_native_rollback_reader; GRANT SELECT ON "User", "Workspace", "ProviderAccountConnection", "PersonalAccountOperation" TO rr_native_rollback_reader',
  );
  const readerURL = new URL(args["database-url"]);
  readerURL.username = "rr_native_rollback_reader";
  const readerOutput = join(output, "old-reader-receipt.json");
  const spec: RollbackReaderInput = {
    contract: "rr-native-connection-old-reader/v1",
    readerSHA: floor,
    bundle,
    bundleSHA256,
    client: clientPath,
    adapter: require.resolve("@prisma/adapter-pg"),
    databaseURL: readerURL.href,
    output: readerOutput,
    cases,
  };
  const specPath = join(temporary, "reader-input.json");
  await writeFile(specPath, JSON.stringify(spec), { mode: 0o600 });
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("./native-connection-rollback-reader.ts", import.meta.url),
      ),
      specPath,
    ],
    {
      cwd: readerRoot,
      timeout: 30_000,
      stdio: "pipe",
      env: { PATH: process.env.PATH },
    },
  );
  const readerReceipt: unknown = JSON.parse(
    await readFile(readerOutput, "utf8"),
  );
  for (const entry of cases) {
    const persisted = await sql.query<{ body: string }>(
      'SELECT to_jsonb(op)::text AS body FROM "PersonalAccountOperation" op WHERE op."actorUserId"=$1 AND op."clientOperationId"=$2',
      [entry.actorUserId, entry.clientOperationId],
    );
    assert.equal(digest(persisted.rows[0]!.body), entry.rowSHA256);
  }
  assert.equal(await treeDigest(generated), generatedClientSHA256);
  cleanSource(writerRoot, args["writer-sha"]);
  cleanSource(readerRoot, floor);
  await writeFile(
    join(output, "rollback-receipt.json"),
    JSON.stringify(
      {
        contract: "rr-native-connection-rollback/v1",
        qualified: true,
        compatibleFloor: floor,
        writerSHA: args["writer-sha"],
        readerSHA: floor,
        phaseEquivalents: {
          prepared: "ready",
          entered: "submitted",
          effectUnknown: "unknown",
        },
        currentWriterRows: 3,
        persistedRowsUnchanged: true,
        rediscoveryCalls: 0,
        effects: 0,
        oldReader: readerReceipt,
      },
      null,
      2,
    ) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      contract: "rr-native-connection-rollback/v1",
      qualified: true,
      compatibleFloor: floor,
      cases: 3,
    }) + "\n",
  );
} finally {
  await db?.$disconnect();
  await sql.end().catch(() => undefined);
  await rm(temporary, { recursive: true, force: true });
}
