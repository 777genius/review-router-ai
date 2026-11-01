import assert from "node:assert/strict";
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
