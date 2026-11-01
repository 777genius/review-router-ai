import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  explicitlyDisabled,
  mergeEnvironmentFile,
  mergeMemoryEnvironment,
  setupMemory,
} from "./setup-memory.ts";

const generated =
  "REVIEW_ROUTER_MEMORY_PROVIDER=hindsight\nREVIEW_ROUTER_MEMORY_ENABLED=true\nREVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY=private-generated-key\n";
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
