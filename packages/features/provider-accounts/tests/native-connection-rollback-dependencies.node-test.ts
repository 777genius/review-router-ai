import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { parse, stringify } from "yaml";
import {
  prepareReaderRuntime,
  selectReaderClosure,
} from "./native-connection-rollback-dependencies.ts";
import {
  compatibleReader,
  digest,
  verifyReaderRuntime,
  type ReaderRuntime,
} from "./native-connection-rollback-runtime.ts";

const writer = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const oldLock = execFileSync(
  "git",
  ["-C", writer, "show", `${compatibleReader}:pnpm-lock.yaml`],
  { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
);
const currentLock = await readFile(join(writer, "pnpm-lock.yaml"), "utf8");
const require = createRequire(import.meta.url);
const client = require.resolve("@prisma/client");
let temporary: string;
let runtime: ReaderRuntime;

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "rr-reader-closure-tests-"));
  ({ runtime } = await prepareReaderRuntime({
    oldLock,
    currentLock,
    writerRoot: writer,
    generated: dirname(createRequire(client).resolve(".prisma/client/default")),
    destination: join(temporary, "runtime"),
  }));
});
after(async () => {
  await rm(temporary, { recursive: true, force: true });
});

test("actual changed monorepo lock preserves all 23 immutable reader snapshots", () => {
  assert.notEqual(digest(currentLock), digest(oldLock));
  const selected = selectReaderClosure(oldLock, currentLock);
  assert.equal(selected.selected.length, 23);
  assert.ok(selected.selected.some((entry) => entry.name === "pg-cloudflare"));
  assert.equal(
    selected.selected.some((entry) =>
      ["prisma", "typescript"].includes(entry.name),
    ),
    false,
  );
});

type MutableLock = {
  importers: Record<
    string,
    { devDependencies: Record<string, { version: string }> }
  >;
  packages: Record<
    string,
    { resolution: { integrity: string }; engines?: { node: string } }
  >;
  snapshots: Record<
    string,
    {
      dependencies: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }
  >;
};
for (const [name, mutate] of [
  [
    "root version",
    (value: MutableLock) => {
      value.importers["."]!.devDependencies.pg!.version = "8.23.1";
    },
  ],
  [
    "runtime edge",
    (value: MutableLock) => {
      value.snapshots["pg@8.23.0"]!.dependencies["pg-connection-string"] =
        "2.14.1";
    },
  ],
  [
    "optional runtime edge",
    (value: MutableLock) => {
      value.snapshots["pg@8.23.0"]!.optionalDependencies = {};
    },
  ],
  [
    "package SRI",
    (value: MutableLock) => {
      value.packages["pg@8.23.0"]!.resolution.integrity =
        `sha512-${"A".repeat(86)}==`;
    },
  ],
  [
    "package engine metadata",
    (value: MutableLock) => {
      value.packages["pg@8.23.0"]!.engines = { node: ">=99" };
    },
  ],
] as const) {
  test(`changed selected ${name} is rejected before runtime preparation`, () => {
    const changed = parse(currentLock) as MutableLock;
    mutate(changed);
    assert.throws(() => selectReaderClosure(oldLock, stringify(changed)));
  });
}

async function rejectedBeforeEffect() {
  let effects = 0;
  await assert.rejects(async () => {
    await verifyReaderRuntime(runtime);
    effects++;
  });
  assert.equal(effects, 0);
}
for (const [name, relativePath] of [
  ["client", "default.js"],
  ["generated WASM", "query_compiler_fast_bg.wasm-base64.js"],
] as const) {
  test(`changed copied ${name} bytes are rejected before imports or database effects`, async () => {
    const root =
      name === "client" ? dirname(runtime.client) : runtime.generated.root;
    const path = join(root, relativePath),
      original = await readFile(path);
    try {
      await chmod(path, 0o600);
      await writeFile(
        path,
        Buffer.concat([original, Buffer.from("\n/* altered */\n")]),
      );
      await rejectedBeforeEffect();
    } finally {
      await writeFile(path, original);
      await chmod(path, 0o400);
    }
  });
}
test("a dependency symlink to the writer graph is rejected before imports or database effects", async () => {
  const pg = runtime.packages.find((item) => item.name === "pg")!;
  const link = join(pg.root, "node_modules", "pg-types"),
    admitted = pg.links["pg-types"]!;
  await unlink(link);
  try {
    await symlink(
      dirname(
        createRequire(require.resolve("pg")).resolve("pg-types/package.json"),
      ),
      link,
      "dir",
    );
    await rejectedBeforeEffect();
  } finally {
    await unlink(link);
    await symlink(admitted, link, "dir");
  }
});

test("fresh-process copied Prisma imports work and both ESM/CommonJS reject optional peers and workspace fallback", async () => {
  const manifest = join(temporary, "runtime.json");
  await writeFile(manifest, JSON.stringify(runtime));
  const sentinel = join(temporary, "outside.cjs");
  await writeFile(
    sentinel,
    "globalThis.readerForbiddenExecuted = true; module.exports = {};\n",
  );
  const helper = pathToFileURL(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "native-connection-rollback-runtime.ts",
    ),
  ).href;
  const probe = join(temporary, "probe.mjs");
  await writeFile(
    probe,
    `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { verifyReaderRuntime, restrictReaderImports, digest } from ${JSON.stringify(helper)};
const runtime = JSON.parse(await readFile(${JSON.stringify(manifest)}, 'utf8'));
const files = await verifyReaderRuntime(runtime);
const boundary = restrictReaderImports(files, ${JSON.stringify(probe)}, digest(await readFile(${JSON.stringify(probe)})));
try {
  const { PrismaClient, Prisma } = await import(pathToFileURL(runtime.client).href);
  const { PrismaPg } = await import(pathToFileURL(runtime.adapter).href);
  assert.equal(Prisma.prismaVersion.client, '7.8.0');
  assert.equal(typeof PrismaClient, 'function');
  assert.equal(typeof PrismaPg, 'function');
  const require = createRequire(import.meta.url);
  for (const request of [${JSON.stringify(sentinel)}, 'typescript', 'prisma', 'pg-native']) {
    assert.throws(() => require(request), /reader module escaped/);
    await assert.rejects(import(request.startsWith('/') ? pathToFileURL(request).href : request), /reader module escaped/);
    assert.equal(globalThis.readerForbiddenExecuted, undefined);
  }
  process.stdout.write(JSON.stringify({ client: '7.8.0', runtimePackages: runtime.packages.length, forbiddenImports: 8, sentinelExecuted: false }) + '\\n');
} finally { boundary.close(); }
`,
  );
  for (const name of ["typescript", "prisma", "pg-native"]) {
    const path = join(temporary, "node_modules", name);
    await mkdir(dirname(path), { recursive: true });
    // Inert sentinels prove a rejected import cannot initialize an outside
    // package. No legacy compiler implementation is installed or executed.
    await symlink(dirname(sentinel), path, "dir");
  }
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({ name: "reader-outside-sentinel", main: "outside.cjs" }),
  );
  const result = execFileSync(process.execPath, [probe], {
    cwd: temporary,
    encoding: "utf8",
    timeout: 30_000,
    env: { PATH: process.env.PATH },
  });
  assert.deepEqual(JSON.parse(result), {
    client: "7.8.0",
    runtimePackages: 23,
    forbiddenImports: 8,
    sentinelExecuted: false,
  });
});
