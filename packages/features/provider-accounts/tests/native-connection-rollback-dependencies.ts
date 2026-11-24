/** Reuse only the immutable floor's admitted SQL runtime, not its whole dev graph. */
import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { parse } from "yaml";
import {
  admittedGeneratedClientSHA256,
  canonical,
  compatibleReader,
  digest,
  equalBytes,
  packageFiles,
  verifyReaderRuntime,
  type ReaderRuntime,
} from "./native-connection-rollback-runtime.ts";

type ObjectValue = Record<string, unknown>;
type Lock = {
  importers: ObjectValue;
  packages: ObjectValue;
  snapshots: ObjectValue;
};
type SelectedPackage = {
  key: string;
  name: string;
  version: string;
  metadata: ObjectValue;
  snapshot: ObjectValue;
  edges: Record<string, string>;
};
type PackageMetadata = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
function object(value: unknown): ObjectValue {
  assert.ok(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value as ObjectValue;
}
function strings(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const entries = object(value);
  assert.ok(Object.values(entries).every((item) => typeof item === "string"));
  return entries as Record<string, string>;
}
function lock(bytes: string): Lock {
  const parsed = object(parse(bytes));
  assert.equal(String(parsed.lockfileVersion), "9.0");
  return {
    importers: object(parsed.importers),
    packages: object(parsed.packages),
    snapshots: object(parsed.snapshots),
  };
}
function rootVersion(source: Lock, importer: string, name: string): string {
  const value = object(source.importers[importer]);
  const dependency = object(
    {
      ...object(value.dependencies ?? {}),
      ...object(value.devDependencies ?? {}),
    }[name],
  );
  assert.equal(typeof dependency.version, "string");
  return dependency.version as string;
}

export function selectReaderClosure(oldBytes: string, currentBytes: string) {
  const old = lock(oldBytes),
    current = lock(currentBytes);
  const roots: Record<string, string> = {};
  for (const name of ["@prisma/client", "@prisma/adapter-pg", "pg"]) {
    const version = rootVersion(old, ".", name);
    for (const importer of [
      ".",
      "packages/platform/db",
      "packages/features/provider-accounts",
    ])
      assert.equal(
        rootVersion(current, importer, name),
        rootVersion(old, importer, name),
      );
    roots[name] = `${name}@${version}`;
  }
  const nodes = new Map<string, SelectedPackage>();
  function visit(name: string, qualifiedVersion: string) {
    const key = `${name}@${qualifiedVersion}`;
    if (nodes.has(key)) return;
    const version = qualifiedVersion.split("(")[0]!;
    const packageKey = `${name}@${version}`;
    const metadata = object(old.packages[packageKey]);
    const snapshot = object(old.snapshots[key]);
    equalBytes(
      canonical(current.packages[packageKey]),
      canonical(metadata),
      `old reader package ${packageKey}`,
    );
    equalBytes(
      canonical(current.snapshots[key]),
      canonical(snapshot),
      `old reader edges ${key}`,
    );
    assert.match(
      String(object(metadata.resolution).integrity),
      /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    );
    const optional = strings(snapshot.optionalDependencies);
    let runtimeOptional = optional;
    if (name === "@prisma/client") {
      // These exact optional peers supply generation/compiler tooling. Runtime
      // client JS uses client-runtime-utils; the copied graph cannot resolve the
      // peers, and the child rejects any import outside its admitted bytes.
      assert.deepEqual(Object.keys(optional).sort(), ["prisma", "typescript"]);
      const peers = object(metadata.peerDependenciesMeta);
      for (const peer of Object.keys(optional))
        assert.equal(object(peers[peer]).optional, true);
      runtimeOptional = {};
    }
    const versions = { ...strings(snapshot.dependencies), ...runtimeOptional };
    const edges = Object.fromEntries(
      Object.entries(versions).map(([dependency, selected]) => [
        dependency,
        `${dependency}@${selected}`,
      ]),
    );
    nodes.set(key, { key, name, version, metadata, snapshot, edges });
    for (const [dependency, selected] of Object.entries(versions))
      visit(dependency, selected);
  }
  for (const [name] of Object.entries(roots))
    visit(name, rootVersion(old, ".", name));
  assert.equal(
    nodes.size,
    23,
    "the compatible floor has exactly 23 admitted runtime package snapshots",
  );
  const selected = [...nodes.values()].sort((a, b) =>
    a.key.localeCompare(b.key, "en"),
  );
  return { roots, selected, sha256: digest(canonical(selected)) };
}

async function metadataPath(name: string, from: string) {
  const require = createRequire(from);
  try {
    return await realpath(require.resolve(`${name}/package.json`));
  } catch (error: unknown) {
    if (
      (error as NodeJS.ErrnoException).code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
      throw error;
  }
  let directory = dirname(await realpath(require.resolve(name)));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(directory, "package.json");
    const bytes = await readFile(candidate, "utf8").catch(() => undefined);
    if (
      bytes !== undefined &&
      (JSON.parse(bytes) as PackageMetadata).name === name
    )
      return candidate;
    directory = dirname(directory);
  }
  throw new Error(`cannot locate admitted reader package ${name}`);
}

async function copyPackage(original: string, destination: string) {
  const files = await packageFiles(original);
  for (const [file, sha256] of files) {
    const bytes = await readFile(join(original, file));
    assert.equal(digest(bytes), sha256);
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o400, flag: "wx" });
  }
  const expected = JSON.stringify(files);
  equalBytes(
    JSON.stringify(await packageFiles(original)),
    expected,
    "source runtime changed while copying",
  );
  equalBytes(
    JSON.stringify(await packageFiles(destination)),
    expected,
    "copied runtime bytes",
  );
  return digest(expected);
}
async function linkDependency(root: string, name: string, target: string) {
  const link = join(root, "node_modules", name);
  await mkdir(dirname(link), { recursive: true, mode: 0o700 });
  await symlink(target, link, "dir");
}

export async function prepareReaderRuntime(input: {
  oldLock: string;
  currentLock: string;
  writerRoot: string;
  readerRoot: string;
  generated: string;
  destination: string;
}) {
  const readerRoot = await realpath(input.readerRoot);
  const writerRoot = await realpath(input.writerRoot);
  assert.notEqual(readerRoot, writerRoot);
  assert.equal(
    digest(input.oldLock),
    "fbffed18bd3fff4c36c70cf9acfa43c1ab6f94f53ae09e39cc0cf15767d79ee9",
    "exact immutable reader lock",
  );
  const installedLock = await readFile(
    join(readerRoot, "pnpm-lock.yaml"),
    "utf8",
  );
  equalBytes(installedLock, input.oldLock, "installed historical lock");
  const closure = selectReaderClosure(input.oldLock, installedLock);
  const selected = new Map(closure.selected.map((entry) => [entry.key, entry]));
  const managed = await realpath(join(readerRoot, "node_modules"));
  assert.ok(managed.startsWith(readerRoot + "/"));
  assert.ok(
    (await realpath(input.generated)).startsWith(managed + "/"),
    "generated client must originate in the historical installation",
  );
  const actual = new Map<
    string,
    { original: string; manifest: string; metadata: PackageMetadata }
  >();
  async function collect(key: string, from: string) {
    const node = selected.get(key);
    assert.ok(node);
    const manifest = await metadataPath(node.name, from);
    const original = dirname(manifest);
    assert.ok(
      original.startsWith(managed + "/"),
      "reader dependency must come from the qualified managed graph",
    );
    const previous = actual.get(key);
    if (previous) {
      assert.equal(original, previous.original);
      return;
    }
    const metadata = JSON.parse(
      await readFile(manifest, "utf8"),
    ) as PackageMetadata;
    assert.equal(metadata.name, node.name);
    assert.equal(metadata.version, node.version);
    const runtimeNames = Object.keys({
      ...metadata.dependencies,
      ...metadata.optionalDependencies,
      ...Object.fromEntries(
        Object.entries(metadata.peerDependencies ?? {}).filter(([name]) =>
          Object.hasOwn(node.edges, name),
        ),
      ),
    }).sort();
    assert.deepEqual(runtimeNames, Object.keys(node.edges).sort());
    for (const [name] of Object.entries(metadata.peerDependencies ?? {}))
      if (!Object.hasOwn(node.edges, name))
        assert.equal(metadata.peerDependenciesMeta?.[name]?.optional, true);
    actual.set(key, { original, manifest, metadata });
    for (const target of Object.values(node.edges))
      await collect(target, manifest);
  }
  for (const key of Object.values(closure.roots))
    await collect(key, join(readerRoot, "package.json"));
  assert.equal(actual.size, closure.selected.length);
  await mkdir(input.destination, { mode: 0o700 });
  const root = await realpath(input.destination);
  const copied = new Map(
    closure.selected.map((entry, index) => [
      entry.key,
      join(root, "packages", String(index)),
    ]),
  );
  const packages: ReaderRuntime["packages"] = [];
  for (const node of closure.selected) {
    const item = actual.get(node.key)!;
    const target = copied.get(node.key)!;
    const links: Record<string, string> = {};
    const treeSHA256 = await copyPackage(item.original, target);
    for (const [name, key] of Object.entries(node.edges)) {
      const dependency = copied.get(key);
      assert.ok(dependency);
      await linkDependency(target, name, dependency);
      links[name] = dependency;
    }
    packages.push({
      key: node.key,
      name: node.name,
      version: node.version,
      root: target,
      treeSHA256,
      links,
    });
  }
  const clientRoot = copied.get(closure.roots["@prisma/client"]!)!;
  const adapterRoot = copied.get(closure.roots["@prisma/adapter-pg"]!)!;
  const generatedRoot = join(root, "generated-client");
  const generatedSHA256 = await copyPackage(input.generated, generatedRoot);
  assert.equal(generatedSHA256, admittedGeneratedClientSHA256);
  await linkDependency(clientRoot, ".prisma/client", generatedRoot);
  await linkDependency(generatedRoot, "@prisma/client", clientRoot);
  packages.find((item) => item.root === clientRoot)!.links[".prisma/client"] =
    generatedRoot;
  const originalRequire = createRequire(join(readerRoot, "package.json"));
  const runtime: ReaderRuntime = {
    contract: "rr-native-reader-runtime/v1",
    readerSHA: compatibleReader,
    root,
    oldLockSHA256: digest(input.oldLock),
    currentLockSHA256: digest(input.currentLock),
    selectedClosureSHA256: closure.sha256,
    packages,
    generated: {
      root: generatedRoot,
      treeSHA256: generatedSHA256,
      links: { "@prisma/client": clientRoot },
    },
    client: join(
      clientRoot,
      relative(
        actual.get(closure.roots["@prisma/client"]!)!.original,
        originalRequire.resolve("@prisma/client"),
      ),
    ),
    adapter: join(
      adapterRoot,
      relative(
        actual.get(closure.roots["@prisma/adapter-pg"]!)!.original,
        originalRequire.resolve("@prisma/adapter-pg"),
      ),
    ),
  };
  await verifyReaderRuntime(runtime);
  return { runtime, closure };
}

export async function readerBuildToolProvenance(
  oldBytes: string,
  currentBytes: string,
  writerRoot: string,
  readerRoot: string,
) {
  const old = lock(oldBytes),
    current = lock(currentBytes);
  const require = createRequire(join(writerRoot, "package.json"));
  const evidence: Record<string, unknown> = {};
  for (const name of ["esbuild", "@esbuild/linux-x64"]) {
    const key = `${name}@0.28.1`;
    equalBytes(
      canonical(current.packages[key]),
      canonical(old.packages[key]),
      `reader build package ${key}`,
    );
    equalBytes(
      canonical(current.snapshots[key]),
      canonical(old.snapshots[key]),
      `reader build edges ${key}`,
    );
    const manifest = await metadataPath(name, require.resolve("esbuild"));
    const metadata = JSON.parse(
      await readFile(manifest, "utf8"),
    ) as PackageMetadata;
    assert.equal(metadata.version, "0.28.1");
    evidence[name] = {
      version: metadata.version,
      packageMetadata: current.packages[key],
      treeSHA256: digest(JSON.stringify(await packageFiles(dirname(manifest)))),
    };
  }
  const readerRequire = createRequire(join(readerRoot, "package.json"));
  const formatterManifest = readerRequire.resolve("prisma/package.json");
  const formatter = JSON.parse(
    await readFile(formatterManifest, "utf8"),
  ) as PackageMetadata;
  assert.equal(formatter.version, "7.8.0");
  return {
    esbuild: evidence,
    formatter: {
      role: "historical reader schema formatter from the immutable floor",
      version: formatter.version,
      readerLockSHA256: digest(oldBytes),
      packageSHA256: digest(await readFile(formatterManifest)),
      entrySHA256: digest(
        await readFile(join(dirname(formatterManifest), "build/index.js")),
      ),
    },
  };
}
