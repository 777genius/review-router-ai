import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, version } from "esbuild";
import { checkConversationSourceStamp } from "./check-conversation-source-stamp.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prefix = "deploy/self-hosted/conversation-verifier";
const sha256 = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/** Deterministic generated code/license parity. No deployment/model proof is made. */
export async function conversationVerifierOutputs() {
  if (version !== "0.28.1")
    throw new Error("conversation_verifier_esbuild_pin_mismatch");
  await checkConversationSourceStamp(root);
  const require = createRequire(
    join(root, "packages/platform/config/package.json"),
  );
  const zodPackage = require.resolve("zod/package.json");
  const zod = JSON.parse(await readFile(zodPackage, "utf8")) as {
    version: string;
  };
  if (zod.version !== "4.4.2")
    throw new Error("conversation_verifier_zod_pin_mismatch");
  const result = await build({
    absWorkingDir: root,
    entryPoints: [`${prefix}-entry.ts`],
    outfile: `${prefix}.mjs`,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    // Zod's JIT templates contain significant blank-line padding. Compiler
    // lowering preserves string values without raw trailing-whitespace lines.
    supported: { "template-literal": false },
    minify: true,
    legalComments: "eof",
    metafile: true,
    write: false,
    banner: {
      js: "// Generated from conversation-verifier-entry.ts. Source metadata/parser only; NOT qualification. See conversation-verifier.NOTICE.",
    },
  });
  const bundle = result.outputFiles[0];
  if (!bundle || result.outputFiles.length !== 1)
    throw new Error("conversation_verifier_output_invalid");
  const inputs = await Promise.all(
    Object.keys(result.metafile.inputs)
      .sort()
      .map(async (path) => [path, sha256(await readFile(join(root, path)))]),
  );
  const notice = `Bundled dependency: zod@${zod.version}\n\n${await readFile(join(dirname(zodPackage), "LICENSE"), "utf8")}`;
  return new Map<string, string | Uint8Array>([
    [`${prefix}.mjs`, bundle.contents],
    [
      `${prefix}.d.mts`,
      '// Generated type handoff for the standalone verifier.\nexport * from "./conversation-verifier-entry.ts";\n',
    ],
    [
      `${prefix}.inputs.json`,
      JSON.stringify(
        {
          kind: "reviewrouter-conversation-verifier-inputs/v1",
          esbuild: version,
          zod: zod.version,
          inputsDigest: sha256(JSON.stringify(inputs)),
          bundleDigest: sha256(bundle.contents),
          noticeDigest: sha256(notice),
        },
        null,
        2,
      ) + "\n",
    ],
    [`${prefix}.NOTICE`, notice],
  ]);
}

export async function checkConversationReleaseVerifier(
  outputRoot = root,
): Promise<void> {
  for (const [path, expected] of await conversationVerifierOutputs()) {
    let actual: Buffer;
    try {
      actual = await readFile(join(outputRoot, path));
    } catch {
      throw new Error("conversation_verifier_missing");
    }
    if (!actual.equals(Buffer.from(expected))) {
      if (path.endsWith("conversation-verifier.inputs.json"))
        console.error("VERIFIER_EXPECTED_INPUTS_METADATA", Buffer.from(expected).toString("utf8"));
      throw new Error("conversation_verifier_stale");
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 1 || !["--check", "--write"].includes(args[0]!))
      throw new Error("usage_conversation_verifier_check_or_write");
    if (args[0] === "--write")
      for (const [path, bytes] of await conversationVerifierOutputs())
        await writeFile(join(root, path), bytes);
    else await checkConversationReleaseVerifier();
    console.log(
      "Standalone conversation verifier coherent; generated parser is not qualification.",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "conversation_verifier_failed",
    );
    process.exitCode = 1;
  }
}
