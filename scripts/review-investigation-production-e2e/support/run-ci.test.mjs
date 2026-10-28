import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// All DB/package commands are local stubs. No service or provisioning involved.
function run(
  mode,
  url = "postgresql://assigned:secret@127.0.0.1:6543/test",
  args = [],
  env = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "item11-runner-test-"));
  const script = `#!/usr/bin/env bash
set -eu
case "$(basename "$0")" in
node) if [[ "$1" == --test ]]; then exit 0; fi; exec '${process.execPath}' "$@" ;;
pnpm) if [[ "$*" == *vitest* ]]; then
  "$REAL_NODE" -e 'require("node:fs").writeFileSync(process.env.TEST_DIR + "/invocation", JSON.stringify({args:process.argv.slice(1), gate:process.env.REVIEW_ROUTER_ITEM11_E2E, url:process.env.REVIEW_ROUTER_ITEM11_DATABASE_URL, runId:process.env.REVIEW_ROUTER_ITEM11_RUN_ID}))' -- "$@"
fi
if [[ "$*" == *"prisma migrate deploy --config"* ]]; then echo before87 >> "$TEST_DIR/stages"; fi
if [[ "$*" == *"db:migrate:deploy"* ]]; then echo full >> "$TEST_DIR/stages"; fi
if [[ "$*" == *vitest* && "$MODE" == live ]]; then touch "$REVIEW_ROUTER_ITEM11_CHILD_PROOF_DIR/pending"; exit 1; fi ;;
psql) if [[ "$*" == *"SELECT oid FROM pg_catalog.pg_roles"* ]]; then
  if [[ -f "$TEST_DIR/role" ]]; then echo 4242; fi
elif [[ "$*" == *pg_database* ]]; then
  if [[ "$MODE" == lookup_failed ]]; then exit 1; fi
  if [[ "$MODE" == existing ]]; then echo foreign; elif [[ -f "$TEST_DIR/created" ]]; then echo owned; fi
else sql="$(cat)"
  if [[ "$sql" == *'DO $fresh$'* ]]; then echo fresh >> "$TEST_DIR/stages"; fi
  if [[ "$sql" == *'DO $disposable_release_role$'* ]]; then
    echo create_role >> "$TEST_DIR/stages"
    if [[ "$MODE" == role_create_failed ]]; then exit 1; fi
    touch "$TEST_DIR/role"
  fi
  if [[ "$sql" == *'DO $item11_pair$'* ]]; then
    echo pair_preflight >> "$TEST_DIR/stages"
    if [[ ! -f "$TEST_DIR/role" || "$MODE" == pair_preflight_failed ]]; then exit 1; fi
  fi
  if [[ "$sql" == *'DO $item11_cleanup$'* ]]; then
    echo drop_role >> "$TEST_DIR/stages"
    if [[ "$MODE" == role_cleanup_failed ]]; then exit 1; fi
    rm "$TEST_DIR/role"
  fi
  if [[ "$sql" == *disposable_before87_handoff_invalid* ]]; then echo handoff >> "$TEST_DIR/stages"; fi
fi ;;
createdb) echo "$PGHOST:$PGPORT:$PGUSER" > "$TEST_DIR/connection"; if [[ "$MODE" == absent ]]; then exit 1; fi; touch "$TEST_DIR/created"; if [[ "$MODE" == uncertain ]]; then exit 1; fi ;;
dropdb) echo "$*" > "$TEST_DIR/dropped"; echo drop_db >> "$TEST_DIR/stages" ;;
esac
`;
  for (const name of ["node", "pnpm", "psql", "createdb", "dropdb"])
    writeFileSync(join(dir, name), script, { mode: 0o700 });
  try {
    const result = spawnSync(
      "bash",
      [
        resolve(
          "scripts/review-investigation-production-e2e/support/run-ci.fixture.sh",
        ),
        ...args,
      ],
      {
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          CI: "true",
          MODE: mode,
          TEST_DIR: dir,
          TMPDIR: dir,
          REVIEW_ROUTER_TEST_DATABASE_URL: url,
          REAL_NODE: process.execPath,
          REVIEW_ROUTER_ITEM11_E2E: "",
          REVIEW_ROUTER_ITEM11_DATABASE_URL: "",
          REVIEW_ROUTER_ITEM11_RUN_ID: "",
          ...env,
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    const read = (name) => {
      try {
        return readFileSync(join(dir, name), "utf8");
      } catch {
        return null;
      }
    };
    return {
      ...result,
      connection: read("connection"),
      dropped: read("dropped"),
      invocation: JSON.parse(read("invocation") ?? "null"),
      stages: read("stages"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
test("runner honors supplied loopback connection and drops only new name without force", () => {
  const r = run("success");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.connection, "127.0.0.1:6543:assigned\n");
  assert.equal(
    r.stages,
    "fresh\ncreate_role\npair_preflight\nbefore87\nhandoff\nfull\ndrop_db\ndrop_role\n",
  );
  assert.match(r.dropped, /^item11_test_[a-f0-9]{32}\n$/);
});
test("item11 rejects a partial release pair before migration and removes only its created role", () => {
  const r = run("pair_preflight_failed");
  assert.equal(r.status, 1);
  assert.equal(
    r.stages,
    "fresh\ncreate_role\npair_preflight\ndrop_db\ndrop_role\n",
  );
  assert.match(r.dropped, /^item11_test_[a-f0-9]{32}\n$/);
  assert.equal(r.invocation, null);
});
test("failed role cleanup reports retained role after exact database deletion", () => {
  const r = run("role_cleanup_failed");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /item11_release_role_cleanup_failed_retained/);
  assert.equal(
    r.stages,
    "fresh\ncreate_role\npair_preflight\nbefore87\nhandoff\nfull\ndrop_db\ndrop_role\n",
  );
});
test("failed role creation never authorizes role deletion", () => {
  const r = run("role_create_failed");
  assert.equal(r.status, 1);
  assert.equal(r.stages, "fresh\ncreate_role\ndrop_db\n");
  assert.match(
    r.stderr,
    /item11_release_role_create_outcome_uncertain_retained/,
  );
});
test("runner retains database when child close is unproven", () => {
  const r = run("live");
  assert.equal(r.status, 1);
  assert.equal(r.dropped, null);
  assert.match(r.stderr, /child_cleanup_unproven_retained/);
  assert.match(r.stderr, /item11_release_role_cleanup_unproven_retained/);
});
test("unknown CREATE outcome reconciles exact owner and reports retained name", () => {
  const r = run("uncertain");
  assert.equal(r.status, 1);
  assert.equal(r.dropped, null);
  assert.match(
    r.stderr,
    /create_outcome_uncertain_retained database=item11_test_[a-f0-9]{32} ownership=owned/,
  );
});
test("runner rejects external URL without commands or credential diagnostics", () => {
  const r = run("success", "postgresql://assigned:secret@remote.invalid/test");
  assert.equal(r.status, 1);
  assert.equal(r.connection, null);
  assert.doesNotMatch(r.stderr, /secret|remote.invalid/);
});

test("failed CREATE with absent catalog entry reports reconciliation without deletion", () => {
  const r = run("absent");
  assert.equal(r.status, 1);
  assert.equal(r.dropped, null);
  assert.match(
    r.stderr,
    /create_reconciled_absent database=item11_test_[a-f0-9]{32}/,
  );
});
test("preexisting database and failed catalog lookup never authorize CREATE or DROP", () => {
  for (const mode of ["existing", "lookup_failed"]) {
    const r = run(mode);
    assert.equal(r.status, 1);
    assert.equal(r.connection, null);
    assert.equal(r.dropped, null);
  }
});

test("exact CI schema input is accepted, owned URL normalized, and item11 forced on", () => {
  const r = run(
    "success",
    "postgresql://postgres:postgres@localhost:5432/reviewrouter_test?schema=public",
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.invocation.gate, "1");
  const url = new URL(r.invocation.url);
  assert.equal(url.search, "");
  assert.equal(url.pathname, `/item11_test_${r.invocation.runId}`);
});
test("unsupported, duplicate, and nonpublic query parameters fail before provisioning", () => {
  for (const query of [
    "schema=private",
    "sslmode=require",
    "schema=public&schema=public",
    "schema=public&x=1",
    "x=1&schema=public",
  ]) {
    const r = run(
      "success",
      "postgresql://assigned:secret@localhost/test?" + query,
    );
    assert.equal(r.status, 1);
    assert.equal(r.connection, null);
    assert.equal(r.invocation, null);
  }
});
test("wrapper forwards filter, reporter, output and run options verbatim after one optional separator", () => {
  const args = [
    "--run",
    "-t",
    "restores durable investigation state after OS process restart",
    "--reporter=json",
    "--outputFile=/tmp/report with spaces.json",
  ];
  for (const prefix of [[], ["--"]]) {
    const r = run("success", undefined, [...prefix, ...args], { CI: "" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.invocation.args, [
      "exec",
      "vitest",
      "run",
      "scripts/review-investigation-production-e2e/review-investigation-production.e2e.test.ts",
      ...args,
    ]);
    assert.equal(r.invocation.gate, "");
    assert.equal(r.connection, null);
  }
  const r = run("success", undefined, ["--", "--", "-t", "literal"], {
    CI: "",
  });
  assert.deepEqual(r.invocation.args.slice(-3), ["--", "-t", "literal"]);
});
test("local explicit gate fails closed before Vitest without matching assignment", () => {
  for (const assignment of [
    {},
    { REVIEW_ROUTER_ITEM11_RUN_ID: "a".repeat(32) },
    {
      REVIEW_ROUTER_ITEM11_RUN_ID: "a".repeat(32),
      REVIEW_ROUTER_ITEM11_DATABASE_URL:
        "postgresql://assigned:secret@localhost/item11_test_" + "b".repeat(32),
    },
  ]) {
    const r = run("success", undefined, [], {
      CI: "",
      REVIEW_ROUTER_ITEM11_E2E: "1",
      ...assignment,
    });
    assert.equal(r.status, 1);
    assert.equal(r.invocation, null);
    assert.equal(r.connection, null);
  }
  const r = run("success", undefined, [], {
    CI: "",
    REVIEW_ROUTER_ITEM11_E2E: "1",
    REVIEW_ROUTER_ITEM11_RUN_ID: "a".repeat(32),
    REVIEW_ROUTER_ITEM11_DATABASE_URL:
      "postgresql://assigned:secret@localhost/item11_test_" + "a".repeat(32),
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.invocation.gate, "1");
  assert.equal(r.connection, null);
});
