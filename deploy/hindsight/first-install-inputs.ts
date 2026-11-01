import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { dockerCommand } from "../../scripts/hindsight-e2e/native-runtime.ts";
import { nativeRevision } from "../../scripts/hindsight-e2e/prepare-hardening.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pins = {
  node: "24.21.0",
  nodeSha256:
    "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6",
  cosignSha256:
    "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71",
  sdkSha512:
    "Tqx7SKEbKZnf9L1tnla3vIDNt83eKFCneHe8GsSQJbmAn0rY8U13fT9Jg5ZP8G/phns5Fk5tZWmagaUlVTzpCA==",
  embedding: [
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "e8f8c211226b894fcb81acc59f3b34ba3efd5f42",
  ],
  reranker: [
    "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    "1427fd652930e4ba29e8149678df786c240d8825",
  ],
} as const;
async function hashFile(
  path: string,
  algorithm = "sha256",
  encoding: "hex" | "base64" = "hex",
) {
  const hash = createHash(algorithm);
  for await (const block of createReadStream(path)) hash.update(block);
  return hash.digest(encoding);
}
async function download(
  url: string,
  path: string,
  expected: string,
  algorithm = "sha256",
  encoding: "hex" | "base64" = "hex",
) {
  try {
    assert(
      (await hashFile(path, algorithm, encoding)) === expected,
      "Downloaded input digest differs",
    );
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  assert(response.ok && response.body, "Pinned setup input is unavailable");
  const partial = `${path}.partial-${randomUUID()}`;
  async function* chunks() {
    const reader = response.body!.getReader();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        yield part.value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  await pipeline(
    chunks(),
    createWriteStream(partial, { flags: "wx", mode: 0o600 }),
  );
  assert(
    (await hashFile(partial, algorithm, encoding)) === expected,
    "Downloaded input digest differs",
  );
  await rename(partial, path);
}

export async function prepareFirstInstallInputs(
  work: string,
  envFile: string,
  modelsDirectory = join(work, "models"),
  evidenceDirectory = join(work, "qualification"),
) {
  await mkdir(join(work, "temp"), { recursive: true, mode: 0o700 });
  await mkdir(join(work, "cache"), { recursive: true, mode: 0o700 });
  const run = async (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv = {},
  ) => {
    const log = await open(join(work, "setup.log"), "a", 0o600);
    try {
      await new Promise<void>((done, reject) => {
        const child = spawn(command, args, {
          cwd: root,
          env: {
            ...process.env,
            TMPDIR: join(work, "temp"),
            XDG_CACHE_HOME: join(work, "cache"),
            ...env,
          },
          stdio: ["ignore", log.fd, log.fd],
        });
        child.once("error", () =>
          reject(
            new Error(
              "Setup executable unavailable; inspect private setup.log",
            ),
          ),
        );
        child.once("exit", (code) =>
          code === 0
            ? done()
            : reject(
                new Error(
                  "Setup phase failed; inspect private setup.log and retained artifacts",
                ),
              ),
        );
      });
    } finally {
      await log.close();
    }
  };
  const evidencePath = join(evidenceDirectory, "evidence.json");
  let qualified:
    | {
        imageId: string;
        postgresImage: string;
        schema: string;
        nativeRevision: string;
        completedAt: string;
      }
    | undefined;
  try {
    qualified = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!qualified) {
    try {
      await lstat(join(work, "qualification.started"));
      assert.fail(
        "Partial native qualification preserved; reconcile its private logs and containers before another run",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const command of ["git", "docker", "tar", "python3"])
      await run(command, ["--version"]);
    const nodeArchive = join(work, "node.tar.xz");
    await download(
      `https://nodejs.org/dist/v${pins.node}/node-v${pins.node}-linux-x64.tar.xz`,
      nodeArchive,
      pins.nodeSha256,
    );
    await run("tar", ["-xJf", nodeArchive, "-C", work]);
    const node = join(work, `node-v${pins.node}-linux-x64`, "bin", "node");
    const cosign = join(work, "cosign");
    await download(
      "https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64",
      cosign,
      pins.cosignSha256,
    );
    await chmod(cosign, 0o700);
    const source = join(work, "hindsight-source");
    try {
      assert(
        (await readFile(join(source, ".git/HEAD"), "utf8")).trim() ===
          nativeRevision,
        "Existing native checkout differs; preserve and reconcile it",
      );
      await run("git", ["-C", source, "diff", "--exit-code", "HEAD"]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await run("git", [
        "clone",
        "--filter=blob:none",
        "--no-checkout",
        "https://github.com/vectorize-io/hindsight.git",
        source,
      ]);
      await run("git", ["-C", source, "checkout", "--detach", nativeRevision]);
    }
    await run("docker", ["pull", "ghcr.io/vectorize-io/hindsight-api:1.1.0"]);
    await run("docker", ["pull", "pgvector/pgvector:pg17"]);
    const nativeBase = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{index .RepoDigests 0}}",
        "ghcr.io/vectorize-io/hindsight-api:1.1.0",
      ])
    ).trim();
    const postgresImage = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        "{{index .RepoDigests 0}}",
        "pgvector/pgvector:pg17",
      ])
    ).trim();
    await run(cosign, [
      "verify",
      nativeBase,
      "--certificate-identity",
      "https://github.com/vectorize-io/hindsight/.github/workflows/release.yml@refs/tags/v1.1.0",
      "--certificate-oidc-issuer",
      "https://token.actions.githubusercontent.com",
    ]);
    const baseRevision = (
      await dockerCommand([
        "image",
        "inspect",
        "--format",
        '{{index .Config.Labels "org.opencontainers.image.revision"}}',
        nativeBase,
      ])
    ).trim();
    assert(
      baseRevision === nativeRevision,
      "Signed native base has an unexpected source revision",
    );
    const sdk = join(work, "sdk.tgz");
    await download(
      "https://github.com/vectorize-io/hindsight/releases/download/v1.1.0/vectorize-io-hindsight-client-1.1.0.tgz",
      sdk,
      pins.sdkSha512,
      "sha512",
      "base64",
    );
    await mkdir(join(work, "sdk"), { recursive: true });
    await run("tar", ["-xzf", sdk, "-C", join(work, "sdk")]);
    const env = {
      HINDSIGHT_SDK_ENTRY: join(work, "sdk/package/dist/index.mjs"),
      HINDSIGHT_SOURCE_CHECKOUT: source,
      HINDSIGHT_QUALIFICATION_POSTGRES_IMAGE: postgresImage,
      HINDSIGHT_QUALIFICATION_OUTPUT: evidenceDirectory,
    };
    const loader = [
      "--experimental-transform-types",
      "--import",
      "./scripts/hindsight-e2e/register-native-runtime.ts",
    ];
    await run(
      node,
      [
        ...loader,
        "--test",
        ...[
          "qualification",
          "cleanup-receipt",
          "provider-contract",
          "operator-safety",
          "provider-verification",
        ].map((name) => `scripts/hindsight-e2e/${name}.test.ts`),
      ],
      env,
    );
    const build = join(work, "hindsight-build");
    await run(node, [
      "scripts/hindsight-e2e/prepare-hardening.ts",
      source,
      build,
    ]);
    await run("python3", [
      "deploy/hindsight/strict-preview.test.py",
      join(build, "hindsight_api"),
    ]);
    await run("git", [
      "-C",
      source,
      "apply",
      "--check",
      join(root, "deploy/hindsight/hardening.patch"),
    ]);
    const tag = `reviewrouter-hindsight:setup-${createHash("sha256").update(envFile).digest("hex").slice(0, 12)}`;
    await run("docker", [
      "build",
      "--build-arg",
      `HINDSIGHT_BASE_IMAGE=${nativeBase}`,
      "--file",
      "deploy/hindsight/Dockerfile",
      "--tag",
      tag,
      build,
    ]);
    await writeFile(
      join(work, "qualification.started"),
      new Date().toISOString(),
      { mode: 0o600, flag: "wx" },
    );
    await run(node, [...loader, "scripts/hindsight-e2e/qualify-native.ts"], {
      ...env,
      HINDSIGHT_QUALIFICATION_IMAGE: tag,
    });
    qualified = JSON.parse(await readFile(evidencePath, "utf8"));
  }
  assert(qualified, "Native qualification did not produce evidence");
  assert(
    qualified.schema === "hindsight-native-qualification/v1" &&
      qualified.nativeRevision === nativeRevision &&
      qualified.completedAt &&
      /^sha256:[a-f0-9]{64}$/.test(qualified.imageId) &&
      /^pgvector\/pgvector@sha256:[a-f0-9]{64}$/.test(qualified.postgresImage),
    "Native qualification evidence is incomplete or belongs to another profile",
  );
  const models = modelsDirectory;
  await mkdir(models, { recursive: true, mode: 0o755 });
  await mkdir(join(models, ".tmp"), { recursive: true, mode: 0o755 });
  const modelMarker = join(models, "snapshot-pins.json");
  const modelPins = JSON.stringify({
    embedding: pins.embedding,
    reranker: pins.reranker,
  });
  try {
    assert(
      (await readFile(modelMarker, "utf8")) === modelPins,
      "Installed model pins differ",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const python =
      "from huggingface_hub import snapshot_download\n" +
      [pins.embedding, pins.reranker]
        .map(
          ([repo, revision], index) =>
            `snapshot_download(repo_id=${JSON.stringify(repo)},revision=${JSON.stringify(revision)},local_dir=${JSON.stringify(`/models/${index === 0 ? "embedding" : "reranker"}`)},allow_patterns=['*.json','model.safetensors','*.model','1_Pooling/*'])`,
        )
        .join("\n");
    await run("docker", [
      "run",
      "--rm",
      "--user=0",
      "--env",
      "HF_HOME=/models/.cache/huggingface",
      "--env",
      "TMPDIR=/models/.tmp",
      "--env",
      "HF_HUB_DISABLE_TELEMETRY=1",
      "--mount",
      `type=bind,src=${models},dst=/models`,
      qualified.imageId,
      "python",
      "-c",
      python,
    ]);
    await writeFile(modelMarker, modelPins, { mode: 0o600, flag: "wx" });
  }
  return { qualified, models, evidencePath };
}
