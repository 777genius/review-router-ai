import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  assertDisposableTempMountIsolation,
  captureDisposableTempCleanupImage,
  cleanupDisposableTempDirectory,
  createDisposableTempDirectory,
  disposableTempCleanupDiagnostic,
  parseDisposableCanonicalSources,
  isInactiveDisposableState,
} from "./disposable-temp-cleanup.ts";

const mountInfo = "1 0 8:1 / / rw - ext4 /dev/fixture rw\n";
const parent = () => mkdtempSync(join(tmpdir(), "rr-temp-cleanup-contract-"));
function docker(args: string[]) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 15000,
  });
  assert.equal(
    result.status,
    0,
    "owned fixture Docker command failed; payload suppressed",
  );
  return result.stdout.trim();
}

test("refuses arbitrary paths without process-owned fresh creation", async () => {
  const directory = parent();
  const sentinel = join(directory, "outside-sentinel");
  writeFileSync(sentinel, "preserve");
  await assert.rejects(
    cleanupDisposableTempDirectory({ path: directory }),
    (error: unknown) =>
      disposableTempCleanupDiagnostic(error).phase === "identity",
  );
  assert.equal(readFileSync(sentinel, "utf8"), "preserve");
  rmSync(directory, { recursive: true });
});

test("refuses a replaced root inode before any Docker or removal effect", async () => {
  const directory = parent();
  const root = createDisposableTempDirectory(directory);
  renameSync(root.path, root.path + "-retained");
  mkdirSync(root.path, { mode: 0o700 });
  writeFileSync(join(root.path, "replacement-sentinel"), "preserve");
  await assert.rejects(
    cleanupDisposableTempDirectory(root),
    (error: unknown) =>
      disposableTempCleanupDiagnostic(error).phase === "identity",
  );
  assert.equal(
    readFileSync(join(root.path, "replacement-sentinel"), "utf8"),
    "preserve",
  );
  rmSync(directory, { recursive: true });
});

test("refuses a root symlink and preserves its outside target", async () => {
  const directory = parent();
  const outside = join(directory, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel"), "preserve");
  const root = createDisposableTempDirectory(directory);
  renameSync(root.path, root.path + "-retained");
  symlinkSync(outside, root.path);
  await assert.rejects(
    cleanupDisposableTempDirectory(root),
    (error: unknown) =>
      disposableTempCleanupDiagnostic(error).phase === "identity",
  );
  assert.equal(readFileSync(join(outside, "sentinel"), "utf8"), "preserve");
  rmSync(directory, { recursive: true });
});

test("refuses both retained bind consumers and named-volume ancestry, including dot-prefixed children", () => {
  for (const source of ["/owned/temp", "/owned/temp/..private", "/owned"])
    assert.throws(
      () =>
        assertDisposableTempMountIsolation(
          "/owned/temp",
          [
            {
              id: "retained-or-active",
              mounts: [{ Type: "bind", Source: source }],
            },
          ],
          mountInfo,
        ),
      (error: unknown) =>
        disposableTempCleanupDiagnostic(error).phase === "container_inventory",
    );
  assert.throws(() =>
    assertDisposableTempMountIsolation(
      "/owned/temp",
      [
        {
          id: "volume-consumer",
          mounts: [{ Type: "volume", Source: "/owned" }],
        },
      ],
      mountInfo,
    ),
  );
  assert.doesNotThrow(() =>
    assertDisposableTempMountIsolation(
      "/owned/temp",
      [
        {
          id: "sibling",
          mounts: [{ Type: "bind", Source: "/owned/temporary" }],
        },
      ],
      mountInfo,
    ),
  );
});

test("refuses a nested foreign host mount and malformed inventories", () => {
  assert.throws(
    () =>
      assertDisposableTempMountIsolation(
        "/owned/temp",
        [],
        mountInfo + "2 1 0:8 / /owned/temp/foreign rw - tmpfs tmpfs rw\n",
      ),
    (error: unknown) =>
      disposableTempCleanupDiagnostic(error).phase === "mount_inventory",
  );
  assert.throws(() =>
    assertDisposableTempMountIsolation(
      "/owned/temp",
      [],
      "not a mount inventory",
    ),
  );
});

test("canonical metadata vectors reject missing, partial and extra paths", () => {
  assert.deepEqual(
    parseDisposableCanonicalSources("/canonical/one\0/canonical/two\0", 2),
    ["/canonical/one", "/canonical/two"],
  );
  for (const output of [
    "/canonical/one\0",
    "/canonical/one\0/canonical/two",
    "/canonical/one\0/canonical/two\0/extra\0",
    "/canonical/one\0relative\0",
  ])
    assert.throws(
      () => parseDisposableCanonicalSources(output, 2),
      (error: unknown) =>
        disposableTempCleanupDiagnostic(error).phase === "container_inventory",
    );
});

test("never exposes raw errors, credentials or absolute paths in refusal diagnostics", () => {
  const diagnostic = disposableTempCleanupDiagnostic(
    Object.assign(new Error("Bearer fixture-secret /real/user/project"), {
      code: "EACCES",
      path: "/real/user/project",
    }),
  );
  assert.deepEqual(diagnostic, {
    phase: "unknown",
    errno: "UNKNOWN",
    pathRelation: "unknown",
  });
});

// This fake transport models metadata and an indeterminate start outcome only.
// It cannot execute the helper or delete children; the permission case below
// separately exercises the actual Docker root helper under an ordinary UID.
function fakeDocker(
  directory: string,
  root: string,
  unknownStart: boolean,
  censusSource?: string,
  censusState?: Record<string, unknown>,
) {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const state = join(directory, "docker-state.json");
  const script = join(bin, "docker-fixture.ts");
  const apiId = "a".repeat(64),
    helperId = "c".repeat(64),
    image = "sha256:" + "b".repeat(64),
    project = "rr-owned-fixture";
  writeFileSync(
    script,
    `import{readFileSync,writeFileSync,existsSync}from'node:fs';const args=process.argv.slice(2);const file=${JSON.stringify(state)};let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{startCalls:0};const save=()=>writeFileSync(file,JSON.stringify(state));const val=k=>args[args.indexOf(k)+1];if(args[0]==='ps'){console.log(state.name?'${helperId}':${JSON.stringify(censusSource ? "f".repeat(64) : "")});}else if(args[0]==='image'){console.log('${image}');}else if(args[0]==='create'){state.name=val('--name');save();console.log('${helperId}');}else if(args[0]==='start'){state.startCalls++;save();process.exitCode=${unknownStart ? 75 : 0};}else if(args[0]==='container'&&args.includes('${"f".repeat(64)}')){console.log(JSON.stringify({id:'${"f".repeat(64)}',mounts:[{Type:'bind',Source:${JSON.stringify(censusSource ?? null)}}],state:${JSON.stringify(censusState ?? null)}}));}else if(args[0]==='container'&&args.includes('${apiId}')){console.log(JSON.stringify({id:'${apiId}',image:'${image}',running:true,project:'${project}',service:'api'}));}else if(args[0]==='container'&&args.includes('${helperId}')){console.log(JSON.stringify({id:'${helperId}',image:'${image}',name:'/'+state.name,labels:{'io.reviewrouter.disposable-temp-cleanup':state.name},user:'0:0',entrypoint:['node'],health:{Test:['NONE']},mounts:[{Type:'bind',Source:${JSON.stringify(root)},Destination:'/owned',RW:true}],host:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapDrop:['ALL'],CapAdd:['CAP_DAC_OVERRIDE','CAP_FOWNER'],SecurityOpt:['no-new-privileges'],RestartPolicy:{Name:'no'},Mounts:[{BindOptions:{NonRecursive:true}}]},state:{Running:false,Status:'created',ExitCode:0,Pid:0}}));}else{process.exitCode=76;}`,
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  writeFileSync(
    join(bin, "docker"),
    `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
    { mode: 0o700 },
  );
  return { bin, state, apiId, project };
}

test(
  "normal host removal still verifies final absence without a privileged helper",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = parent();
    const root = createDisposableTempDirectory(directory);
    writeFileSync(join(root.path, "owned"), "fixture");
    const fixture = fakeDocker(directory, root.path, false);
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = `${fixture.bin}:${oldPath}`;
      assert.deepEqual(await cleanupDisposableTempDirectory(root), {
        status: "removed",
        method: "host",
      });
      assert.equal(existsSync(root.path), false);
    } finally {
      process.env.PATH = oldPath;
      rmSync(directory, { recursive: true });
    }
  },
);

const inactiveState = {
  Status: "exited",
  Running: false,
  Paused: false,
  Restarting: false,
  Dead: false,
  Pid: 0,
};
test("only explicit created/exited false flags and PID0 qualify as inactive", () => {
  assert.equal(isInactiveDisposableState(inactiveState), true);
  assert.equal(
    isInactiveDisposableState({ ...inactiveState, Status: "created" }),
    true,
  );
  for (const state of [
    null,
    {},
    { ...inactiveState, Status: "running" },
    { ...inactiveState, Running: true },
    { ...inactiveState, Paused: true },
    { ...inactiveState, Restarting: true },
    { ...inactiveState, Dead: true },
    { ...inactiveState, Pid: 1 },
    { ...inactiveState, Pid: "0" },
    { ...inactiveState, Error: "not-part-of-metadata-contract" },
  ])
    assert.equal(isInactiveDisposableState(state), false);
});

test(
  "truly inactive outside aliases need no existing-target proof but known overlaps still refuse",
  { skip: process.platform !== "linux" },
  async () => {
    for (const overlap of [false, true]) {
      const directory = parent();
      const root = createDisposableTempDirectory(directory);
      const sentinel = join(root.path, "sentinel");
      writeFileSync(sentinel, "preserve");
      const fixture = fakeDocker(
        directory,
        root.path,
        false,
        overlap
          ? join(root.path, "retained-child")
          : join(directory, "missing-outside"),
        inactiveState,
      );
      const oldPath = process.env.PATH;
      try {
        process.env.PATH = `${fixture.bin}:${oldPath}`;
        if (overlap) {
          await assert.rejects(
            cleanupDisposableTempDirectory(root),
            (error: unknown) =>
              disposableTempCleanupDiagnostic(error).reason ===
              "container_mount_overlaps_root",
          );
          assert.equal(readFileSync(sentinel, "utf8"), "preserve");
        } else {
          assert.equal(
            (await cleanupDisposableTempDirectory(root)).method,
            "host",
          );
          assert.equal(existsSync(root.path), false);
        }
      } finally {
        process.env.PATH = oldPath;
        rmSync(directory, { recursive: true });
      }
    }
  },
);

test(
  "missing bind targets remain unknown and cannot authorize removal",
  { skip: process.platform !== "linux" },
  async () => {
    const directory = parent();
    const root = createDisposableTempDirectory(directory);
    const sentinel = join(root.path, "preserve");
    writeFileSync(sentinel, "preserve");
    const fixture = fakeDocker(
      directory,
      root.path,
      false,
      join(directory, "missing-bind-source"),
    );
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = `${fixture.bin}:${oldPath}`;
      await assert.rejects(
        cleanupDisposableTempDirectory(root),
        (error: unknown) => {
          const diagnostic = disposableTempCleanupDiagnostic(error);
          assert.equal(diagnostic.phase, "container_inventory");
          assert.equal(diagnostic.errno, "ENOENT");
          return true;
        },
      );
      assert.equal(readFileSync(sentinel, "utf8"), "preserve");
    } finally {
      process.env.PATH = oldPath;
      rmSync(directory, { recursive: true });
    }
  },
);

test(
  "unknown Docker start retains the root and never automatically starts or retries again",
  { skip: process.platform !== "linux" || process.getuid?.() === 0 },
  async () => {
    const directory = parent();
    const root = createDisposableTempDirectory(directory);
    const denied = join(root.path, "denied");
    mkdirSync(denied);
    writeFileSync(join(denied, "keep"), "fixture");
    const fixture = fakeDocker(directory, root.path, true);
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = `${fixture.bin}:${oldPath}`;
      captureDisposableTempCleanupImage(root, fixture.apiId, fixture.project);
      chmodSync(denied, 0);
      await assert.rejects(
        cleanupDisposableTempDirectory(root),
        (error: unknown) => {
          const diagnostic = disposableTempCleanupDiagnostic(error);
          assert.equal(diagnostic.phase, "helper_start");
          assert.equal(diagnostic.firstHostFailure?.errno, "EACCES");
          return true;
        },
      );
      await assert.rejects(cleanupDisposableTempDirectory(root));
      assert.equal(
        JSON.parse(readFileSync(fixture.state, "utf8")).startCalls,
        1,
      );
      assert.equal(lstatSync(root.path).isDirectory(), true);
      chmodSync(denied, 0o700);
      assert.equal(readFileSync(join(denied, "keep"), "utf8"), "fixture");
    } finally {
      process.env.PATH = oldPath;
      chmodSync(denied, 0o700);
      rmSync(directory, { recursive: true });
    }
  },
);

const image = process.env.REVIEW_ROUTER_TEMP_CLEANUP_TEST_IMAGE_ID;
test(
  "real ordinary-UID cleanup removes only fresh foreign-UID0700 children using the captured immutable image",
  { skip: !image, timeout: 120000 },
  async () => {
    assert.equal(
      process.getuid?.(),
      1000,
      "permission regression requires ordinary host UID1000",
    );
    assert.match(image!, /^sha256:[a-f0-9]{64}$/);
    const directory = parent();
    const outside = join(directory, "outside-sentinel");
    writeFileSync(outside, "preserve");
    const root = createDisposableTempDirectory(directory);
    const writable = join(root.path, "fixture-writable");
    mkdirSync(writable, { mode: 0o777 });
    chmodSync(writable, 0o777);
    const name = `rr-temp-permission-fixture-${randomUUID()}`;
    const project = name;
    const program = `const fs=require('node:fs');fs.mkdirSync('/fixture/foreign',{mode:0o700});fs.writeFileSync('/fixture/foreign/owned','fixture');fs.symlinkSync(${JSON.stringify(outside)},'/fixture/foreign/outside-link');console.log('ready');setInterval(()=>{},1000);`;
    let id: string | undefined;
    try {
      id = docker([
        "run",
        "--pull",
        "never",
        "--detach",
        "--name",
        name,
        "--label",
        `com.docker.compose.project=${project}`,
        "--label",
        "com.docker.compose.service=api",
        "--user",
        "700:700",
        "--cap-drop",
        "ALL",
        "--network",
        "none",
        "--read-only",
        "--entrypoint",
        "node",
        "--mount",
        `type=bind,src=${writable},dst=/fixture`,
        image!,
        "-e",
        program,
      ]);
      for (
        let attempt = 0;
        attempt < 50 && !existsSync(join(writable, "foreign"));
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(lstatSync(join(writable, "foreign")).uid, 700);
      assert.equal(lstatSync(join(writable, "foreign")).mode & 0o777, 0o700);
      captureDisposableTempCleanupImage(root, id, project);
      docker(["stop", "--time", "2", id]);
      docker(["rm", id]);
      id = undefined;
      assert.throws(
        () =>
          rmSync(root.path, { recursive: true, force: false, maxRetries: 0 }),
        (error: unknown) =>
          ["EACCES", "EPERM"].includes((error as { code: string }).code),
      );
      const receipt = await cleanupDisposableTempDirectory(root);
      assert.equal(receipt.method, "isolated_root_helper");
      assert.equal(existsSync(root.path), false);
      assert.equal(readFileSync(outside, "utf8"), "preserve");
      console.log(
        JSON.stringify({
          qualification: "foreign_uid_0700",
          hostUid: process.getuid?.(),
          foreignUid: 700,
          oldHostRm: "permission_denied",
          result: receipt,
          outsideSentinel: "preserved",
          imageId: image,
        }),
      );
    } finally {
      if (id) {
        docker(["stop", "--time", "2", id]);
        docker(["rm", id]);
      }
      // On refusal leave the exact owned permission fixture for diagnosis; never
      // use a broad privileged remove as test cleanup.
      if (!existsSync(root.path)) rmSync(directory, { recursive: true });
    }
  },
);
