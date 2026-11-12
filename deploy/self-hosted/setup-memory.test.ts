import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  explicitlyDisabled,
  mergeEnvironmentFile,
  mergeMemoryEnvironment,
  setupMemory,
  planConversationEnvironment,
} from "./setup-memory.ts";
import {
  readConversationRelease,
  conversationReleaseArtifact,
  conversationReleaseSources,
  conversationQualificationEnvironmentValue,
} from "./conversation-release.ts";
import { conversationCapabilityFixture } from "../../packages/platform/config/src/tests/conversation-qualification-fixture.ts";
import {
  readConversationQualification,
  conversationCapabilityAppliesToScope,
} from "../../packages/platform/config/src/conversation-qualification.ts";
import {
  currentConversationSourceStamp,
  checkConversationSourceStamp,
  conversationSourceStampPath,
} from "../../scripts/check-conversation-source-stamp.ts";
import * as standalone from "./conversation-verifier.mjs";
import {
  checkConversationReleaseVerifier,
  conversationVerifierOutputs,
} from "../../scripts/check-conversation-release-verifier.ts";

const generated =
  "REVIEW_ROUTER_MEMORY_PROVIDER=hindsight\nREVIEW_ROUTER_MEMORY_ENABLED=true\nREVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY=private-generated-key\n";

// These temporary declarations have synthetic proof IDs. They test release
// consumption and source binding, never model quality or production activation.
async function releaseFixture() {
  const directory = await mkdtemp(
    join(tmpdir(), "rr-conversation-release-test-"),
  );
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const declaration = conversationCapabilityFixture({
    proofId: "synthetic-installer-unit-evidence",
  });
  for (const source of Object.values(conversationReleaseSources)) {
    await mkdir(dirname(join(directory, source)), { recursive: true });
    await writeFile(
      join(directory, source),
      await readFile(join(sourceRoot, source)),
    );
  }
  // Test the selected manifest/archive identity, not only provenance metadata.
  const sdk = JSON.parse(
    await readFile(
      join(sourceRoot, conversationReleaseSources.gatewaySdkProvenanceDigest),
      "utf8",
    ),
  ) as { archive: string };
  for (const source of [
    "apps/api/package.json",
    `vendor/account-gateway/${sdk.archive}`,
  ]) {
    await mkdir(dirname(join(directory, source)), { recursive: true });
    await writeFile(
      join(directory, source),
      await readFile(join(sourceRoot, source)),
    );
  }
  const writeArtifact = async (value: unknown = declaration) => {
    const path = join(directory, conversationReleaseArtifact);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  };
  return { directory, declaration, writeArtifact };
}

test("release admission refuses a changed SDK manifest or archive even with matching provenance", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    assert.equal((await readConversationRelease(f.directory)).status, "available");
    const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const manifestPath = join(f.directory, "apps/api/package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies["@agent-teams/account-gateway"] =
      "file:../../vendor/account-gateway/unqualified.tgz";
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.deepEqual(await readConversationRelease(f.directory), {
      status: "unqualified",
      reason: "release_source_mismatch",
    });
    await writeFile(
      manifestPath,
      await readFile(join(sourceRoot, "apps/api/package.json")),
    );
    const provenance = JSON.parse(
      await readFile(
        join(f.directory, conversationReleaseSources.gatewaySdkProvenanceDigest),
        "utf8",
      ),
    ) as { archive: string };
    await writeFile(
      join(f.directory, "vendor/account-gateway", provenance.archive),
      "tampered archive",
    );
    assert.deepEqual(await readConversationRelease(f.directory), {
      status: "unqualified",
      reason: "release_source_mismatch",
    });
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("absent release artifact leaves ordinary storage setup available without a conversation default", async () => {
  const f = await releaseFixture();
  try {
    const plan = await planConversationEnvironment(
      "AUTH_SECRET=kept\n",
      f.directory,
    );
    assert.deepEqual(plan, {
      status: "unqualified",
      reason: "release_artifact_absent",
    });
    const path = join(f.directory, ".env");
    await writeFile(path, "AUTH_SECRET=kept\n", { mode: 0o600 });
    await mergeEnvironmentFile(path, "AUTH_SECRET=kept\n", generated);
    const actual = await readFile(path, "utf8");
    assert(actual.includes("REVIEW_ROUTER_MEMORY_PROVIDER=hindsight"));
    assert(!actual.includes("REVIEW_ROUTER_CONVERSATION_QUALIFICATION"));
    assert(!actual.includes("REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA"));
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("release artifact checks actual installed source and rejects unknown fields without blocking storage", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact({ ...f.declaration, repositories: "*" });
    assert.deepEqual(await readConversationRelease(f.directory), {
      status: "unqualified",
      reason: "release_artifact_invalid",
    });
    await f.writeArtifact({ ...f.declaration, issuer: "invented" });
    assert.deepEqual(await readConversationRelease(f.directory), {
      status: "unqualified",
      reason: "release_artifact_invalid",
    });
    await f.writeArtifact();
    await writeFile(
      join(f.directory, conversationReleaseSources.accountPolicySourceDigest),
      "changed source bytes",
    );
    assert.deepEqual(await planConversationEnvironment("", f.directory), {
      status: "unqualified",
      reason: "release_source_mismatch",
    });
    assert(
      mergeMemoryEnvironment("AUTH_SECRET=kept\n", generated).includes(
        "REVIEW_ROUTER_MEMORY_PROVIDER=hindsight",
      ),
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("every declared implementation/provenance digest is checked against its actual installed file", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    for (const source of Object.values(conversationReleaseSources)) {
      const path = join(f.directory, source);
      const original = await readFile(path);
      await writeFile(
        path,
        Buffer.concat([original, Buffer.from("source drift")]),
      );
      assert.deepEqual(await readConversationRelease(f.directory), {
        status: "unqualified",
        reason: "release_source_mismatch",
      });
      await writeFile(path, original);
    }
    assert.equal(
      (await readConversationRelease(f.directory)).status,
      "available",
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("verified synthetic release installs exactly the complete two-key tuple through the existing env CAS", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    const plan = await planConversationEnvironment(
      "AUTH_SECRET=kept\n",
      f.directory,
    );
    assert.equal(plan.status, "available");
    if (plan.status !== "available")
      throw new Error("fixture release unavailable");
    const original = "AUTH_SECRET=kept\n";
    const path = join(f.directory, ".env");
    await writeFile(path, original, { mode: 0o600 });
    await mergeEnvironmentFile(path, original, generated, plan.environment);
    const merged = await readFile(path, "utf8");
    assert(merged.startsWith(original));
    assert.equal(
      merged.split("REVIEW_ROUTER_CONVERSATION_QUALIFICATION=").length,
      2,
    );
    assert.equal(
      merged.split("REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=").length,
      2,
    );
    const installed = await planConversationEnvironment(merged, f.directory);
    assert.deepEqual(installed, { status: "existing_configuration_preserved" });
    assert.equal(
      mergeMemoryEnvironment(merged, generated, plan.environment),
      merged,
    );
    await writeFile(path, "AUTH_SECRET=concurrent-edit\n", { mode: 0o600 });
    await assert.rejects(
      mergeEnvironmentFile(path, original, generated, plan.environment),
      /changed during setup/,
    );
    assert.equal(await readFile(path, "utf8"), "AUTH_SECRET=concurrent-edit\n");
    assert.throws(
      () =>
        mergeMemoryEnvironment(
          original,
          "REVIEW_ROUTER_CONVERSATION_QUALIFICATION=unverified\n",
        ),
      /unexpected key/,
    );
    assert.throws(
      () =>
        mergeMemoryEnvironment(original, generated, {
          ...plan.environment,
          interactionRuntimeSha: "b".repeat(40),
        }),
      /tuple_invalid/,
    );
    assert.throws(
      () =>
        mergeMemoryEnvironment(original, generated, {
          ...plan.environment,
          qualification: JSON.stringify({
            ...f.declaration,
            sourceProfile: {
              ...f.declaration.sourceProfile,
              accountPolicySourceDigest: "0".repeat(64),
            },
          }),
        }),
      /tuple_invalid/,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("existing v1/v2 declarations, independent pins and mixed/empty operator input are never overwritten", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    const release = await readConversationRelease(f.directory);
    if (release.status !== "available")
      throw new Error("fixture release unavailable");
    const {
      sourceProfile: _source,
      coverage: _coverage,
      ...shared
    } = f.declaration;
    void _source;
    void _coverage;
    const v1 = JSON.stringify({
      ...shared,
      profileVersion: 1,
      repositories: [
        {
          workspaceId: "operator-workspace",
          repositoryId: "operator-repository",
        },
      ],
    });
    for (const original of [
      `REVIEW_ROUTER_CONVERSATION_QUALIFICATION='${v1}'\nREVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=${f.declaration.runtimeSha}\n`,
      `REVIEW_ROUTER_CONVERSATION_QUALIFICATION=${JSON.stringify(f.declaration)}\nREVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=${f.declaration.runtimeSha}\n`,
      `REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=${"b".repeat(40)}\n`,
      "REVIEW_ROUTER_CONVERSATION_QUALIFICATION=\n",
      "REVIEW_ROUTER_CONVERSATION_QUALIFICATION += operator-input\n",
      "\uFEFFREVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA\n",
      "\uFEFFREVIEW_ROUTER_CONVERSATION_QUALIFICATION += operator-input\n",
      `REVIEW_ROUTER_CONVERSATION_QUALIFICATION=${JSON.stringify(f.declaration)}\nREVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=${"b".repeat(40)}\n`,
    ]) {
      const plan = await planConversationEnvironment(original, f.directory);
      assert.notEqual(plan.status, "available");
      const merged = mergeMemoryEnvironment(
        original,
        generated,
        release.environment,
      );
      assert(merged.startsWith(original));
      assert.equal(
        merged.includes("synthetic-installer-unit-evidence"),
        original.includes("synthetic-installer-unit-evidence"),
      );
      assert(
        !merged
          .slice(original.length)
          .includes("REVIEW_ROUTER_CONVERSATION_QUALIFICATION"),
      );
      assert(
        !merged
          .slice(original.length)
          .includes("REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA"),
      );
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("provider/service opt-outs never install release capability", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    const release = await readConversationRelease(f.directory);
    if (release.status !== "available")
      throw new Error("fixture release unavailable");
    for (const original of [
      "REVIEW_ROUTER_MEMORY_PROVIDER=disabled\n",
      "REVIEW_ROUTER_MEMORY_ENABLED=false\n",
      "REVIEW_ROUTER_DISABLE_MEMORY=true\n",
    ]) {
      assert.deepEqual(
        await planConversationEnvironment(original, f.directory),
        { status: "operator_opt_out" },
      );
      const merged = mergeMemoryEnvironment(
        original,
        generated,
        release.environment,
      );
      assert(!merged.includes("REVIEW_ROUTER_CONVERSATION_QUALIFICATION="));
      assert(
        !merged.includes("REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA="),
      );
    }
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("conversation source identity refuses a different installed SDK or archive bytes", async () => {
  const f = await releaseFixture();
  try {
    await currentConversationSourceStamp(f.directory);
    const manifestPath = join(f.directory, "apps/api/package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies["@agent-teams/account-gateway"] =
      "file:../../vendor/account-gateway/unqualified.tgz";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      currentConversationSourceStamp(f.directory),
      /conversation_sdk_manifest_mismatch/,
    );
    const sourceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    await writeFile(
      manifestPath,
      await readFile(join(sourceRoot, "apps/api/package.json")),
    );
    const source = JSON.parse(
      await readFile(
        join(
          f.directory,
          conversationReleaseSources.gatewaySdkProvenanceDigest,
        ),
        "utf8",
      ),
    ) as { archive: string };
    await writeFile(
      join(f.directory, "vendor/account-gateway", source.archive),
      "changed SDK bytes",
    );
    await assert.rejects(
      currentConversationSourceStamp(f.directory),
      /conversation_sdk_archive_integrity_mismatch/,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("source stamp is metadata only; stale existing v2 configuration stays intact but cannot authorize automatic capability", async () => {
  const f = await releaseFixture();
  try {
    const stamp = await currentConversationSourceStamp(f.directory);
    await mkdir(dirname(join(f.directory, conversationSourceStampPath)), {
      recursive: true,
    });
    await writeFile(
      join(f.directory, conversationSourceStampPath),
      JSON.stringify(stamp),
    );
    await checkConversationSourceStamp(f.directory);
    assert.throws(
      () => readConversationQualification(JSON.stringify(stamp)),
      /qualification_invalid/,
    );
    await writeFile(
      join(f.directory, conversationReleaseSources.gatewayPreviewSourceDigest),
      "drift",
    );
    await assert.rejects(
      checkConversationSourceStamp(f.directory),
      /stamp_stale/,
    );
    const stale = {
      ...f.declaration,
      sourceProfile: {
        ...f.declaration.sourceProfile,
        accountPolicySourceDigest: "0".repeat(64),
      },
    };
    const original = `REVIEW_ROUTER_CONVERSATION_QUALIFICATION=${JSON.stringify(stale)}\nREVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA=${stale.runtimeSha}\n`;
    assert.deepEqual(await planConversationEnvironment(original, f.directory), {
      status: "unqualified",
      reason: "existing_configuration_source_mismatch",
    });
    const merged = mergeMemoryEnvironment(original, generated);
    assert(merged.startsWith(original));
    const parsed = readConversationQualification(JSON.stringify(stale));
    assert.equal(
      conversationCapabilityAppliesToScope(parsed, {
        workspaceId: "authorized-workspace",
        repositoryId: "authorized-repository",
      }),
      false,
    );
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("Compose serialization preserves parsed evidence without interpolation or comment injection", () => {
  const declaration = conversationCapabilityFixture({
    proofId: "synthetic $TOKEN # comment ' quote\nsecond line",
  });
  const serialized = conversationQualificationEnvironmentValue(
    JSON.stringify(declaration),
  );
  assert(!/[$#'\r\n]/.test(serialized));
  assert.deepEqual(JSON.parse(serialized), declaration);
});

test("generated standalone verifier and authoritative API parser agree without creating evidence", () => {
  const current = conversationCapabilityFixture();
  const cases: unknown[] = [
    current,
    {
      ...current,
      sourceProfile: {
        ...current.sourceProfile,
        accountPolicySourceDigest: "0".repeat(64),
      },
    },
    { ...current, coverage: undefined },
    { ...current, repositories: "*" },
    { ...current, sourceProcessingProfile: "transient-checked-inline-v1" },
    { ...current, models: [] },
    null,
  ];
  for (const value of cases) {
    const raw = JSON.stringify(value);
    let api: ReturnType<typeof readConversationQualification> | undefined;
    try {
      api = readConversationQualification(raw);
    } catch {
      assert.throws(
        () => standalone.readConversationQualification(raw),
        /qualification_invalid/,
      );
      continue;
    }
    assert.deepEqual(standalone.readConversationQualification(raw), api);
    if (api?.profileVersion === 2)
      assert.equal(
        standalone.conversationSourceProfileMatches(api.sourceProfile),
        conversationCapabilityAppliesToScope(api, {
          workspaceId: "fixture",
          repositoryId: "fixture",
        }),
      );
  }
});

test("generated verifier input/bundle/license parity rejects missing or stale generated bytes", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "rr-conversation-verifier-parity-"),
  );
  try {
    await assert.rejects(
      checkConversationReleaseVerifier(directory),
      /verifier_missing/,
    );
    for (const [path, bytes] of await conversationVerifierOutputs()) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes);
    }
    await checkConversationReleaseVerifier(directory);
    await writeFile(
      join(directory, "deploy/self-hosted/conversation-verifier.mjs"),
      "stale generated verifier",
    );
    await assert.rejects(
      checkConversationReleaseVerifier(directory),
      /verifier_stale/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh dependency-free checkout consumes a source-coherent synthetic artifact using the standalone parser", async () => {
  const f = await releaseFixture();
  try {
    await f.writeArtifact();
    const sourceRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../..",
    );
    for (const path of [
      "deploy/self-hosted/conversation-release.ts",
      "deploy/self-hosted/conversation-verifier.mjs",
      "packages/platform/config/src/conversation-source-files.ts",
    ]) {
      await mkdir(dirname(join(f.directory, path)), { recursive: true });
      await writeFile(
        join(f.directory, path),
        await readFile(join(sourceRoot, path)),
      );
    }
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `import { pathToFileURL } from 'node:url';
      const root=process.argv[1];
      const {readConversationRelease}=await import(pathToFileURL(root+'/deploy/self-hosted/conversation-release.ts').href);
      const result=await readConversationRelease(root);
      if(result.status!=='available')process.exit(2);
      console.log(result.status);`,
        f.directory,
      ],
      { encoding: "utf8", env: {} },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "available");
  } finally {
    await rm(f.directory, { recursive: true, force: true });
  }
});
test("explicit provider opt-out is preserved without infrastructure work", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-memory-setup-"));
  try {
    const original =
      'AUTH_SECRET=keep-me\nREVIEW_ROUTER_MEMORY_PROVIDER="disabled"\n';
    assert.equal(explicitlyDisabled(original), true);
    assert.equal(mergeMemoryEnvironment(original, generated), original);
    const path = join(directory, ".env");
    await writeFile(path, original, { mode: 0o600 });
    assert.deepEqual(await setupMemory(path, join(directory, "untouched")), {
      status: "explicitly_disabled",
      envFile: path,
    });
    await assert.rejects(
      readFile(join(directory, "untouched/setup-binding.json")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("merge preserves unrelated secrets and intentional service pauses and is idempotent", () => {
  const original =
    "# existing\nAUTH_SECRET=keep-me\nREVIEW_ROUTER_MEMORY_ENABLED=false\n";
  const merged = mergeMemoryEnvironment(original, generated);
  assert(merged.includes("AUTH_SECRET=keep-me"));
  assert(merged.includes("REVIEW_ROUTER_MEMORY_ENABLED=false"));
  assert.equal(mergeMemoryEnvironment(merged, generated), merged);
  assert.throws(
    () => mergeMemoryEnvironment(original, "AUTH_SECRET=overwrite\n"),
    /unexpected key/,
  );
});
test("atomic env merge refuses changed content and preserves the operator edit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rr-memory-cas-"));
  try {
    const path = join(directory, ".env");
    const original = "AUTH_SECRET=original\n";
    await writeFile(path, "AUTH_SECRET=concurrent-edit\n", { mode: 0o600 });
    await assert.rejects(
      mergeEnvironmentFile(path, original, generated),
      /changed during setup/,
    );
    assert.equal(await readFile(path, "utf8"), "AUTH_SECRET=concurrent-edit\n");
    await mergeEnvironmentFile(
      path,
      "AUTH_SECRET=concurrent-edit\n",
      generated,
    );
    assert(
      (await readFile(path, "utf8")).includes(
        "REVIEW_ROUTER_MEMORY_PROVIDER=hindsight",
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const assignmentForms = [
  (key: string, value: string) => `${key}=${value}`,
  (key: string, value: string) => `export ${key}=${value}`,
  (key: string, value: string) => `  ${key} = ${value} # operator choice`,
  (key: string, value: string) => `${key}: ${value} # operator choice`,
  (key: string, value: string) =>
    `export ${key} : "${value}" # operator choice`,
  (key: string, value: string) => `\t${key}:'${value}'# operator choice`,
];
test("Compose assignment forms preserve opt-outs and both pause controls", () => {
  const secrets =
    "  export UNRELATED_SECRET = 'fixture first\r\nREVIEW_ROUTER_MEMORY_PROVIDER=disabled\r\nfixture last' # keep    \r\nOTHER_SECRET: \"fixture # literal\" # keep\t\r\n";
  for (const form of assignmentForms) {
    const disabled = `${secrets}${form("REVIEW_ROUTER_MEMORY_PROVIDER", "disabled")}\r\n`;
    assert.equal(explicitlyDisabled(disabled), true);
    assert.equal(mergeMemoryEnvironment(disabled, generated), disabled);
    for (const [key, value] of [
      ["REVIEW_ROUTER_MEMORY_ENABLED", "false"],
      ["REVIEW_ROUTER_DISABLE_MEMORY", "true"],
    ]) {
      const original = `${secrets}${form(key!, value!)}\r\n`;
      assert.equal(explicitlyDisabled(original), false);
      const merged = mergeMemoryEnvironment(original, generated);
      assert(merged.startsWith(secrets));
      assert(merged.includes(form(key!, value!)));
      assert(!merged.includes("REVIEW_ROUTER_MEMORY_ENABLED=true"));
      assert.equal(mergeMemoryEnvironment(merged, generated), merged);
    }
  }
});
test("unsupported or dynamic memory controls fail closed", () => {
  for (const declaration of [
    "REVIEW_ROUTER_MEMORY_ENABLED",
    "export REVIEW_ROUTER_DISABLE_MEMORY",
    "REVIEW_ROUTER_MEMORY_ENABLED += false",
    "REVIEW_ROUTER_MEMORY_PROVIDER=${PROVIDER:-disabled}",
    'REVIEW_ROUTER_MEMORY_ENABLED="${PAUSE}"',
    'REVIEW_ROUTER_MEMORY_ENABLED="f\\alse"',
    'REVIEW_ROUTER_MEMORY_PROVIDER="disabled',
    'OTHER="fixture" REVIEW_ROUTER_MEMORY_PROVIDER=disabled',
    "REVIEW_ROUTER_MEMORY_ENABLED=false#not-a-compose-comment",
    "REVIEW_ROUTER_MEMORY_PROVIDER=disabled#not-a-compose-comment",
    "REVIEW_ROUTER_MEMORY_PROVIDER=unknown-backend",
  ])
    assert.throws(() => mergeMemoryEnvironment(`${declaration}\n`, generated));
});

const composeAvailable =
  spawnSync("docker", ["compose", "version"], { stdio: "ignore" }).status === 0;
test(
  "real Compose env_file parsing agrees with retained opt-out and pause semantics",
  { skip: !composeAvailable },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "rr-memory-compose-env-"));
    try {
      const cases: { name: string; key: string; value: string }[] = [];
      const services: string[] = ["services:"];
      for (const form of assignmentForms) {
        for (const [key, value] of [
          ["REVIEW_ROUTER_MEMORY_PROVIDER", "disabled"],
          ["REVIEW_ROUTER_MEMORY_ENABLED", "false"],
          ["REVIEW_ROUTER_DISABLE_MEMORY", "true"],
        ]) {
          const name = `case${cases.length}`;
          const original = `${form(key!, value!)}\n`;
          await writeFile(
            join(directory, `${name}.env`),
            mergeMemoryEnvironment(original, generated),
          );
          services.push(
            `  ${name}:\n    image: scratch\n    env_file: [./${name}.env]`,
          );
          cases.push({ name, key: key!, value: value! });
        }
      }
      const path = join(directory, "compose.yml");
      await writeFile(path, services.join("\n") + "\n");
      const result = spawnSync(
        "docker",
        [
          "compose",
          "--project-name",
          "rr-memory-env-grammar",
          "--file",
          path,
          "config",
          "--format",
          "json",
        ],
        { encoding: "utf8", cwd: directory },
      );
      assert.equal(
        result.status,
        0,
        "Compose could not parse the disposable fixture",
      );
      const parsed = JSON.parse(result.stdout) as {
        services: Record<string, { environment: Record<string, string> }>;
      };
      for (const item of cases) {
        const environment = parsed.services[item.name]!.environment;
        assert.equal(environment[item.key], item.value);
        if (item.key === "REVIEW_ROUTER_DISABLE_MEMORY")
          assert(!("REVIEW_ROUTER_MEMORY_ENABLED" in environment));
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "real Compose preserves the exact parsed release tuple without expanding artifact text",
  { skip: !composeAvailable },
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rr-conversation-compose-env-"),
    );
    try {
      const declaration = conversationCapabilityFixture({
        proofId: "synthetic $UNSET # literal ' quote\nsecond line",
      });
      const environment = {
        qualification: JSON.stringify(declaration),
        interactionRuntimeSha: declaration.runtimeSha,
      };
      await writeFile(
        join(directory, "release.env"),
        mergeMemoryEnvironment("AUTH_SECRET=kept\n", generated, environment),
      );
      const file = join(directory, "compose.yml");
      await writeFile(
        file,
        "services:\n  fixture:\n    image: scratch\n    env_file: [./release.env]\n",
      );
      const result = spawnSync(
        "docker",
        [
          "compose",
          "--project-name",
          "rr-conversation-env-grammar",
          "--file",
          file,
          "config",
          "--format",
          "json",
        ],
        {
          encoding: "utf8",
          cwd: directory,
          env: { ...process.env, UNSET: "must-not-expand" },
        },
      );
      assert.equal(
        result.status,
        0,
        "Compose could not parse the synthetic release tuple",
      );
      const parsed = JSON.parse(result.stdout) as {
        services: { fixture: { environment: Record<string, string> } };
      };
      assert.deepEqual(
        JSON.parse(
          parsed.services.fixture.environment
            .REVIEW_ROUTER_CONVERSATION_QUALIFICATION!,
        ),
        declaration,
      );
      assert.equal(
        parsed.services.fixture.environment
          .REVIEW_ROUTER_GATEWAY_INTERACTION_RUNTIME_SHA,
        declaration.runtimeSha,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
