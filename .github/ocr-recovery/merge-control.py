"""Temporary exact-revision integration aid; not application code or rollout authority."""
from pathlib import Path
import hashlib
import re
import subprocess

ROOT = Path.cwd()
MAIN = "5551a572fce38aaa3453bbef1ff9af79d3c293de"
HEAD = "476a2e0c400e3b6abde5d33a41557652e78765d0"
MIGRATION = "000154_unified_model_dispatch"
MANIFEST = "sha256:67de1583cf2ae194e7b6dd5cef021d08b60eb64988d516cb2adcbc2d01bbbda3"


def source(revision, name):
    return subprocess.check_output(["git", "show", f"{revision}:{name}"], text=True)


def write(name, value):
    (ROOT / name).write_text(value)


def replace(value, before, after, count=-1):
    if before not in value:
        raise RuntimeError("Expected source anchor is absent: " + before[:100])
    return value.replace(before, after, count)


def mutate(name, function):
    current = (ROOT / name).read_text()
    updated = function(current)
    if current == updated:
        raise RuntimeError("Expected modification is absent: " + name)
    write(name, updated)


def resolve(name, function):
    ordinal = [0]
    def apply(match):
        index = ordinal[0]
        ordinal[0] += 1
        return function(index, match[1], match[2])
    mutate(name, lambda text: re.sub(r"<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> [^\n]+\n", apply, text, flags=re.S))


resolve(".github/workflows/ci.yml", lambda _, ours, theirs: ours)
resolve("apps/api/src/review-action-v2-production-composition.ts", lambda _, ours, theirs:
        "        accountModelCatalogEnabled: readAccountModelCatalogEnabled(input.env),\n        companionDispatches: modelDispatchAdmission,\n")
resolve("apps/web/app/dashboard/repository-setup-optimistic-status.tsx", lambda _, ours, theirs:
        replace(theirs, '  return scopedStep === "ready" &&', '  const step = scopedStep === "ready" &&') +
        "  return runtimeQualifiedSetupStep(step, currentStep, runtimeCompatibility);\n")
resolve("apps/web/app/dashboard/repository-setup-progress-panel.tsx", lambda _, ours, theirs: '''  // Never render the previous scope's optimistic progress before its effect resets.
  const scopedStep =
    optimisticScopeKey === scopeKey ? currentStep : initialStep;
  const displayStep = runtimeQualifiedSetupStep(
    gatewayBlocked && scopedStep === "ready" ? "provider" : scopedStep,
    initialStep,
    runtimeCompatibility,
  );
''')


def snapshot_resolution(index, ours, theirs):
    if index == 0:
        return "  selectModelDispatchReviewAgentProfile,\n" + theirs
    beginning = ours.index("        : explicitAgentProfileRef")
    ending = ours.index("    } catch (error)")
    return ours[:beginning] + '''        : selectReviewRunAgentProfile({
            profiles: agentProfiles,
            modelTransport,
            ...(explicitAgentProfileRef !== undefined
              ? { explicitProfileRef: explicitAgentProfileRef }
              : {}),
            suppliedDiffOnly: selected?.provider.agenticContext === false,
            defaultProfileRef: this.agentProfileRef,
            preferSkillsProfile: this.preferSkillsProfile,
            reviewSkillsDelivery: providerApiAuthMode !== undefined,
          });
''' + ours[ending:]


resolve("apps/api/src/review-run-runtime-snapshot.ts", snapshot_resolution)
mutate("packages/features/review-run-control/src/domain/review-run-runtime-snapshot.ts", lambda text:
       replace(replace(text,
       '    typeof value.providerKind !== "string" ||\n    !["ocr", "codex"].includes(value.providerKind) ||',
       '    (value.providerKind !== "ocr" && value.providerKind !== "codex") ||'),
       "  return Object.freeze({ ...value }) as LifecycleVerificationCapability;", '''  return Object.freeze({
    extensionId: lifecycleVerificationContract.extensionId,
    descriptorDigest: lifecycleVerificationDescriptorDigest,
    executor: lifecycleVerificationContract.executor,
    modelTransport: "account_gateway",
    providerIndex: Number(value.providerIndex),
    providerKind: value.providerKind,
    model: value.model,
    maxDispatches: 2,
    maxPromptBytes: Number(value.maxPromptBytes),
    maxResponseBytes: Number(value.maxResponseBytes),
    maxOutputTokens: Number(value.maxOutputTokens),
    deadlineMs: Number(value.deadlineMs),
    attemptBudget: 1,
  });'''))


def architecture(text):
    text = replace(text, '  const expectedExports = [".", "./v2", "./v2/contract-source"];',
                   '  const expectedExports = [".", "./oidc", "./v2", "./v2/contract-source"];')
    text = replace(text, '"action-control-plane exports must keep the v1 root plus only the deliberate v2 interface and contract-source subpaths",',
                   '"action-control-plane exports must keep only the v1 root and reviewed oidc, v2 interface and contract-source subpaths",')
    return replace(text, "  const publicExports = Object.keys(packageJson.exports ?? {}).sort();", '''  const oidcExport = packageJson.exports?.["./oidc"];
  if (
    !oidcExport ||
    Object.keys(oidcExport).sort().join(",") !== "default,production,types" ||
    oidcExport.types !== "./src/oidc.ts" ||
    oidcExport.default !== "./src/oidc.ts" ||
    oidcExport.production !== "./dist/oidc.js"
  ) {
    violations.push({
      file: join(actionControlPlaneRoot, "package.json"),
      imported: "./oidc",
      reason: "the OIDC subpath must target the isolated reviewed verifier adapter",
    });
  }
  const publicExports = Object.keys(packageJson.exports ?? {}).sort();''')


mutate("scripts/check-architecture-boundaries.mjs", architecture)


def architecture_tests(text):
    text = replace(text, '        exports: { ".": {}, "./v2": {}, "./v2/contract-source": {} },', '''        exports: {
          ".": {},
          "./oidc": {
            types: "./src/oidc.ts",
            production: "./dist/oidc.js",
            default: "./src/oidc.ts",
          },
          "./v2": {},
          "./v2/contract-source": {},
        },''')
    return replace(text, '  it("accepts only the three named usage transport adapters and fixture", () => {', '''  it.each(["./internal", "./*"])("rejects an unreviewed export %s", (subpath) => {
    const root = protocolFixture();
    writeFile(root, "packages/features/action-control-plane/package.json", JSON.stringify({
      exports: {
        ".": {},
        "./oidc": { types: "./src/oidc.ts", production: "./dist/oidc.js", default: "./src/oidc.ts" },
        "./v2": {}, "./v2/contract-source": {}, [subpath]: "./src/index.ts",
      },
    }));
    expect(() => runChecker(root)).toThrow(/reviewed oidc, v2 interface/);
  });

  it("rejects redirecting the OIDC seam to the eager root adapter graph", () => {
    const root = protocolFixture();
    writeFile(root, "packages/features/action-control-plane/package.json", JSON.stringify({
      exports: {
        ".": {},
        "./oidc": { types: "./src/index.ts", production: "./dist/index.js", default: "./src/index.ts" },
        "./v2": {}, "./v2/contract-source": {},
      },
    }));
    expect(() => runChecker(root)).toThrow(/isolated reviewed verifier adapter/);
  });

  it("accepts only the three named usage transport adapters and fixture", () => {''')


mutate("scripts/check-architecture-boundaries.test.ts", architecture_tests)
for filename in ["account-gateway-operator-grants.yml", "provider-accounts-c1.yml", "account-gateway-long-run.yml"]:
    path = ".github/workflows/" + filename
    text = (ROOT / path).read_text()
    before = "pnpm install --frozen-lockfile --ignore-scripts"
    after = "node scripts/install-private-dependencies.mjs --frozen-lockfile"
    if before in text:
        text = text.replace(before, after)
    elif after not in text:
        raise RuntimeError("Unexpected dependency installer: " + path)
    if "      - scripts/install-private-dependencies.mjs\n" not in text:
        text = replace(text, "      - pnpm-lock.yaml\n", "      - pnpm-lock.yaml\n      - scripts/install-private-dependencies.mjs\n")
    write(path, text)

rows = [(p.parent.name, hashlib.sha256(p.read_bytes()).hexdigest())
        for p in sorted((ROOT / "packages/platform/db/prisma/migrations").glob("*/migration.sql"))]
actual = "sha256:" + hashlib.sha256(",".join(name + ":" + checksum for name, checksum in rows).encode()).hexdigest()
if len(rows) != 156 or actual != MANIFEST:
    raise RuntimeError("The merged migration inventory changed")
print("Exact merged migration manifest:", actual, flush=True)

for name in ["packages/features/review-run-control/src/tests/review-agent-profile.test.ts",
             "scripts/accounts-reference-e2e/src/contracts.ts",
             "scripts/lib/provider-key-checkout-admission.test.ts",
             "scripts/rehearse-private-pg17-rollout.mjs"]:
    resolve(name, lambda _, ours, theirs: ours + theirs)
resolve("scripts/accounts-reference-e2e/src/run.ts", lambda index, ours, theirs:
        ours + theirs if index == 0 else ours + '    : process.argv.includes("--skill-catalog-fixture")\n      ? SKILL_CATALOG_FIXTURE_BOUNDARY\n')
resolve("scripts/codex-rotating-release-migration-workflow.test.ts", lambda _, ours, theirs: ours.replace("152", "156"))

name = "scripts/lib/render-schema-handoff-policy.mjs"
text, feature = source(MAIN, name), source(HEAD, name)
start = feature.index("  // Unified dispatch extends")
end = feature.index("  // Repository-secret profile identities", start)
block = feature[start:end].replace("complete checkout152", "complete checkout156 or historical checkout152")
block = replace(block, 'manifest(catalog) !==\n        "sha256:f8bc4e6289b679d7f4142426e67e77ab347be8f8bed5937072ebc1ca54218fcc"',
                '![\n        "' + MANIFEST + '\",\n        "sha256:f8bc4e6289b679d7f4142426e67e77ab347be8f8bed5937072ebc1ca54218fcc",\n      ].includes(manifest(catalog))')
write(name, replace(text, "  // Review history is checkout-only.", block + "  // Review history is checkout-only.", 1))
name = "scripts/lib/render-historical96-checkout.mjs"
text = source(MAIN, name)
text = replace(text, '  "000151_review_history",', '  "000151_review_history",\n  "' + MIGRATION + '",')
write(name, replace(text, "150, 151, 152, 153, 154,", "150, 151, 152, 153, 154, 155,"))
resolve("scripts/lib/render-historical96-checkout.test.ts", lambda _, ours, theirs:
        ours if "000155_unknown" in ours else ours + theirs)

name = "packages/features/release-rollout/src/domain/release-migration-transition.test.ts"
text = source(MAIN, name)
text = replace(text, "keeps checkout155 history admission", "keeps checkout156 unified and checkout155 history admission")
text = replace(text, "    const checkout155 = names.map", "    const checkout156 = names.map")
text = replace(text, "    expect(checkout155).toHaveLength(155);", '''    expect(checkout156).toHaveLength(156);
    const unifiedExtension: Row = {
      migrationName: "000154_unified_model_dispatch",
      checksum: "0ecebe5d1437544b0be81e946731a8bde39d1d3eb51a3516b465014323c70884",
    };
    expect(checkout156.at(-1)).toEqual(unifiedExtension);
    const checkout155 = checkout156.filter((row) => row.migrationName !== unifiedExtension.migrationName);
    expect(checkout155).toHaveLength(155);''', 1)
text = replace(text, "    expect(manifest(checkout155)).toBe(", '''    expect(manifest(checkout156)).toBe("''' + MANIFEST + '''");
    expect(partitionRenderSchemaHandoffCheckout(checkout156)).toEqual(managed);
    const historical152 = [...checkout151, unifiedExtension];
    expect(manifest(historical152)).toBe("sha256:f8bc4e6289b679d7f4142426e67e77ab347be8f8bed5937072ebc1ca54218fcc");
    expect(partitionRenderSchemaHandoffCheckout(historical152)).toEqual(managed);
    expect(manifest(checkout155)).toBe(''', 1)
write(name, replace(text, "    expect(checkout155).toEqual(readRenderManagedCheckoutInventory());", "    expect(checkout156).toEqual(readRenderManagedCheckoutInventory());"))

name = "scripts/lib/render-schema-handoff-policy.test.ts"
text = source(MAIN, name)
text = replace(text, "const skillsCatalogMigrationName =", '''const unifiedModelDispatchMigrationName = "000154_unified_model_dispatch";
const withoutUnifiedDispatch = <T extends { migrationName: string }>(rows: readonly T[]) =>
  rows.filter((row) => row.migrationName !== unifiedModelDispatchMigrationName);
const readPriorCheckoutInventory = () => withoutUnifiedDispatch(readRenderManagedCheckoutInventory());
const skillsCatalogMigrationName =''', 1)
text = replace(text, "withoutReviewHistory(readRenderManagedCheckoutInventory())", "withoutReviewHistory(readPriorCheckoutInventory())")
text = replace(text, "    const full = readRenderManagedCheckoutInventory();\n    expect(full).toHaveLength(155);", "    const full = readPriorCheckoutInventory();\n    expect(full).toHaveLength(155);")
text = replace(text, "    if (count !== undefined) {", "    if (count !== undefined) {\n      rmSync(join(migrations, unifiedModelDispatchMigrationName), { recursive: true });", 1)
text = replace(text, "reads current checkout155 through checkout154", "reads current checkout156 through checkout155, checkout154", 1)
text = replace(text, "    expect(inventory).toHaveLength(155);\n    expect(fixture.read()).toEqual(catalog);", '''    expect(inventory).toHaveLength(156);
    expect(fixture.read()).toEqual(catalog);
    rmSync(join(fixture.migrations, unifiedModelDispatchMigrationName), { recursive: true });
    expect(readdirSync(fixture.migrations)).toHaveLength(155);
    expect(fixture.read()).toEqual(catalog);''', 1)
text = replace(text, "// Only the newest approved tail may be removed from checkout155; all", "// Only the newest approved tail may be removed from checkout156; all")
text = replace(text, "      if (name === reviewHistoryMigrationName)\n        expect(fixture.read()).toEqual(catalog);", "      if (name === unifiedModelDispatchMigrationName)\n        expect(fixture.read()).toEqual(catalog);")
new_test = '''  it("admits exact unified checkout156 and historical152 without expanding managed92", () => {
    const full = readRenderManagedCheckoutInventory();
    expect(full).toHaveLength(156);
    expect(full.at(-1)).toEqual({ migrationName: unifiedModelDispatchMigrationName,
      checksum: "0ecebe5d1437544b0be81e946731a8bde39d1d3eb51a3516b465014323c70884" });
    const digest = (rows: typeof full) => `sha256:${createHash("sha256").update(rows.map((row) => `${row.migrationName}:${row.checksum}`).join(",")).digest("hex")}`;
    expect(digest(full)).toBe("''' + MANIFEST + '''");
    expect(partitionRenderSchemaHandoffCheckout(full)).toEqual(catalog);
    expect(partitionRenderSchemaHandoffCheckout(readPriorCheckoutInventory())).toEqual(catalog);
    const historical152 = [...readRepositorySecretProfilesCheckoutInventory(), full.at(-1)!];
    expect(historical152).toHaveLength(152);
    expect(digest(historical152)).toBe("sha256:f8bc4e6289b679d7f4142426e67e77ab347be8f8bed5937072ebc1ca54218fcc");
    expect(partitionRenderSchemaHandoffCheckout(historical152)).toEqual(catalog);
    for (const changed of [
      full.map((row) => row.migrationName === unifiedModelDispatchMigrationName ? { ...row, checksum: "0".repeat(64) } : row),
      full.map((row) => row.migrationName === unifiedModelDispatchMigrationName ? { ...row, migrationName: "000154_relabelled" } : row),
      full.filter((row) => row.migrationName !== reviewHistoryMigrationName),
      full.filter((row) => row.migrationName !== skillsCatalogMigrationName),
      [...full, { migrationName: "000155_unknown", checksum: "0".repeat(64) }],
      [...full, full.at(-1)!], [...full].reverse(),
    ]) expect(() => partitionRenderSchemaHandoffCheckout(changed)).toThrow();
  });

'''
write(name, replace(text, '  it("admits only the exact review-history155', new_test + '  it("admits only the exact review-history155', 1))
resolve("scripts/lib/render-schema-handoff-transaction.test.ts", lambda index, ours, theirs:
        theirs.replace("checkout155", "checkout156").replace("155,", "156,") if index == 0 else theirs + ours)
resolve("scripts/rehearse-private-pg17-rollout.test.ts", lambda index, ours, theirs:
        ours + theirs if index in [0, 3, 5, 6] else ours if index == 4 else theirs.replace("155", "156") if index == 1 else theirs)
name = "scripts/rehearse-private-pg17-rollout.test.ts"
text = (ROOT / name).read_text()
text = replace(text, '      "sha256:3d7b45be5b1654757f1bf72626e6f3f7c9b1351bb82ce93819bca2e4a38b7dbf",\n    );',
               '      "' + MANIFEST + '''",
    );
    expect(migrationManifestIdentity(currentMigrationNames.filter((name) => name !== "000154_unified_model_dispatch"))).toBe(
      "sha256:3d7b45be5b1654757f1bf72626e6f3f7c9b1351bb82ce93819bca2e4a38b7dbf",
    );''', 1)
start = text.index("// Strip only the new reviewed tail")
end = text.index("\n  });", start)
block = text[start:end].replace('name !== "000151_review_history" &&', 'name !== "000154_unified_model_dispatch" &&\n            name !== "000151_review_history" &&')
write(name, text[:start] + block + text[end:])

# Generated bundles are rebuilt from the merged sources by the existing build.
subprocess.run(["git", "checkout", "--theirs", "--", "action-dist/conflict-runtime.cjs"], check=True)
subprocess.run(["git", "add", "--all"], check=True)
if subprocess.check_output(["git", "ls-files", "-u"], text=True).strip():
    raise RuntimeError("Unresolved integration conflicts remain")
print("Source resolutions complete; executable qualification has not run yet.", flush=True)
