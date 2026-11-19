import test from "node:test";
import assert from "node:assert/strict";
import {
  nextValue,
  roleUpdates,
  roleContainerOnly,
  applyEnvList,
  applyCanonical,
  roleExtraHosts,
  plannedConfig,
  validateSpec,
  requireUnsetOutsideImageEnv,
} from "./fleet-overlay.mjs";

test("appendJsonArray keeps existing bytes and is idempotent", () => {
  const before = '[{"a":1,"b":[2]},{"a":3}]';
  const after = nextValue(before, { op: "appendJsonArray", value: { a: 4 } });
  assert.equal(after, '[{"a":1,"b":[2]},{"a":3},{"a":4}]');
  assert.equal(
    nextValue(after, { op: "appendJsonArray", value: { a: 4 } }),
    after,
  );
});
test("appendCsv appends once", () => {
  assert.equal(nextValue("x,y", { op: "appendCsv", value: "z" }), "x,y,z");
  assert.equal(nextValue("x,y,z", { op: "appendCsv", value: "z" }), "x,y,z");
});
test("targeted key missing on a role is an error, role filter skips others", () => {
  const env = new Map([["A", "1"]]);
  assert.throws(
    () => roleUpdates("api", env, [{ key: "B", op: "set", value: "2" }]),
    /update_key_missing:B/,
  );
  assert.equal(
    roleUpdates("api", env, [
      { key: "B", op: "set", value: "2", roles: ["web"] },
    ]).size,
    0,
  );
});
test("env list keeps order and only touches updated keys", () => {
  assert.deepEqual(applyEnvList(["A=1", "B=2", "C=3"], new Map([["B", "9"]])), [
    "A=1",
    "B=9",
    "C=3",
  ]);
});
test("adding configuration requires absence in both container and canonical environment", () => {
  const env = new Map([["A", "1"]]);
  const updates = roleUpdates("api", env, [
    { key: "MEMORY", op: "add", value: "configured" },
  ]);
  assert.deepEqual(applyEnvList(["A=1"], updates), [
    "A=1",
    "MEMORY=configured",
  ]);
  assert.equal(
    applyCanonical("A=1\n", env, updates),
    "A=1\nMEMORY=configured\n",
  );
  assert.throws(
    () =>
      roleUpdates("api", new Map([["MEMORY", "disabled"]]), [
        { key: "MEMORY", op: "add", value: "configured" },
      ]),
    /update_key_exists/,
  );
  assert.throws(
    () => applyCanonical("A=1\nMEMORY=disabled\n", env, updates),
    /canonical_key_exists/,
  );
});
test("canonical update requires the file to match the container value", () => {
  const text = "A=1\nB=2\nC=3\n";
  assert.equal(
    applyCanonical(text, new Map([["B", "2"]]), new Map([["B", "9"]])),
    "A=1\nB=9\nC=3\n",
  );
  assert.throws(
    () =>
      applyCanonical(text, new Map([["B", "other"]]), new Map([["B", "9"]])),
    /canonical_differs_from_container:B/,
  );
  assert.throws(
    () =>
      applyCanonical(
        "B=2\nB=2\n",
        new Map([["B", "2"]]),
        new Map([["B", "9"]]),
      ),
    /canonical_line_count:B/,
  );
});
test("container-only keys are skipped in the canonical file, extra hosts are appended once per role", () => {
  const text = "A=1\n";
  assert.equal(
    applyCanonical(
      text,
      new Map([["G", "x"]]),
      new Map([["G", "y"]]),
      new Set(["G"]),
    ),
    text,
  );
  const spec = [{ entry: "h.example:172.19.0.1", roles: ["web"] }];
  assert.deepEqual(roleExtraHosts("web", ["a:1.1.1.1"], spec), [
    "a:1.1.1.1",
    "h.example:172.19.0.1",
  ]);
  assert.deepEqual(roleExtraHosts("web", ["h.example:172.19.0.1"], spec), [
    "h.example:172.19.0.1",
  ]);
  assert.deepEqual(roleExtraHosts("api", ["a:1.1.1.1"], spec), ["a:1.1.1.1"]);
});

test("plannedConfig without a target only changes Env", () => {
  const baseline = {
    Image: "old:tag",
    Env: ["A=1"],
    Labels: { x: "1" },
    User: "app",
  };
  const planned = plannedConfig(baseline, ["A=2"], null);
  assert.deepEqual(planned, { ...baseline, Env: ["A=2"] });
  assert.equal(baseline.Env[0], "A=1");
});

test("plannedConfig with a target swaps Image and OCI labels, keeps other labels", () => {
  const baseline = {
    Image: "old:tag",
    Env: ["A=1"],
    Labels: {
      "org.opencontainers.image.revision": "a".repeat(40),
      "org.opencontainers.image.source": "https://example.test/old",
      "com.example.keep": "yes",
    },
    User: "app",
  };
  const planned = plannedConfig(
    baseline,
    ["A=1"],
    { ref: "new:tag" },
    {
      "org.opencontainers.image.revision": "b".repeat(40),
      "not.oci": "ignored",
    },
  );
  assert.equal(planned.Image, "new:tag");
  assert.equal(planned.User, "app");
  assert.deepEqual(planned.Labels, {
    "org.opencontainers.image.revision": "b".repeat(40),
    "org.opencontainers.image.source": "https://example.test/old",
    "com.example.keep": "yes",
  });
  assert.equal(
    baseline.Labels["org.opencontainers.image.revision"],
    "a".repeat(40),
  );
});

test("container-only updates cannot bypass canonical additions or another role", () => {
  assert.throws(
    () =>
      roleUpdates("api", new Map(), [
        { key: "MEMORY", op: "add", value: "configured", containerOnly: true },
      ]),
    /spec_add_requires_canonical/,
  );
  const updates = [
    {
      key: "MEMORY",
      op: "set",
      value: "configured",
      roles: ["web"],
      containerOnly: true,
    },
  ];
  assert.deepEqual([...roleContainerOnly("web", updates)], ["MEMORY"]);
  assert.deepEqual([...roleContainerOnly("api", updates)], []);
  assert.throws(
    () =>
      applyCanonical(
        "MEMORY=disabled\n",
        new Map(),
        new Map([["MEMORY", "configured"]]),
        roleContainerOnly("web", updates),
      ),
    /spec_add_requires_canonical/,
  );
  assert.throws(
    () =>
      applyCanonical(
        "MEMORY=disabled\n",
        new Map(),
        new Map([["MEMORY", "configured"]]),
        roleContainerOnly("api", updates),
      ),
    /canonical_key_exists/,
  );
});

const progressKeys = [
  "REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE",
  "REVIEW_ROUTER_PROGRESS_FILE_COVERAGE",
  "REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES",
  "REVIEW_ROUTER_PROGRESS_REPOSITORIES",
];
const progressEnv = () =>
  new Map([
    ["A", "1"],
    ["REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE", "1"],
    ["REVIEW_ROUTER_PROGRESS_FILE_COVERAGE", "1"],
    ["REVIEW_ROUTER_HOSTED_PROGRESS_COMMENT_WRITES", "0"],
    ["REVIEW_ROUTER_PROGRESS_REPOSITORIES", "owner/repo"],
  ]);
const asList = (env) => [...env].map(([k, v]) => `${k}=${v}`);
const asFile = (env) => `${asList(env).join("\n")}\n`;
const unsetAll = progressKeys.map((key) => ({
  key,
  op: "unset",
  roles: ["api", "worker", "scan"],
}));

test("unset removes the key from the container env and its one canonical line, on api, worker and scan only", () => {
  for (const role of ["api", "worker", "scan"]) {
    const env = progressEnv();
    const updates = roleUpdates(role, env, unsetAll);
    assert.deepEqual([...updates.keys()], progressKeys);
    assert.deepEqual(applyEnvList(asList(env), updates), ["A=1"]);
    assert.equal(applyCanonical(asFile(env), env, updates), "A=1\n");
  }
  // web has none of these keys; the role filter skips it instead of failing.
  assert.equal(roleUpdates("web", new Map([["A", "1"]]), unsetAll).size, 0);
});

test("unset keeps the set CAS: a canonical line that differs from the container aborts", () => {
  const env = progressEnv();
  const updates = roleUpdates("worker", env, unsetAll);
  const drifted = asFile(env).replace(
    "REVIEW_ROUTER_PROGRESS_REPOSITORIES=owner/repo",
    "REVIEW_ROUTER_PROGRESS_REPOSITORIES=other/repo",
  );
  assert.throws(
    () => applyCanonical(drifted, env, updates),
    /canonical_differs_from_container:REVIEW_ROUTER_PROGRESS_REPOSITORIES/,
  );
  assert.throws(
    () =>
      applyCanonical(
        `${asFile(env)}REVIEW_ROUTER_PROGRESS_FILE_COVERAGE=1\n`,
        env,
        updates,
      ),
    /canonical_line_count:REVIEW_ROUTER_PROGRESS_FILE_COVERAGE/,
  );
  assert.throws(
    () => applyCanonical("A=1\n", env, updates),
    /canonical_line_count:REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE/,
  );
});

test("unset of an absent key is an error, not a silent no-op, so a second run fails before touching anything", () => {
  assert.throws(
    () => roleUpdates("worker", new Map([["A", "1"]]), unsetAll),
    /update_key_missing:REVIEW_ROUTER_PROGRESS_PROJECTION_CAPTURE/,
  );
  assert.throws(
    () =>
      roleUpdates("worker", progressEnv(), [
        { key: "A", op: "unset" },
        { key: "A", op: "set", value: "2" },
      ]),
    /update_after_unset:A/,
  );
  assert.throws(
    () => applyCanonical("A=1\n", new Map(), new Map([["B", null]])),
    /update_key_missing:B/,
  );
});

test("container-only unset leaves the canonical file alone", () => {
  const env = new Map([["G", "x"]]);
  const updates = roleUpdates("api", env, [
    { key: "G", op: "unset", containerOnly: true },
  ]);
  assert.deepEqual(applyEnvList(["G=x", "A=1"], updates), ["A=1"]);
  assert.equal(applyCanonical("A=1\n", env, updates, new Set(["G"])), "A=1\n");
});

test("spec validation: unset takes no value, every other op keeps its old value rules", () => {
  const base = {
    machineId: "a".repeat(32),
    expectedImage: `sha256:${"b".repeat(64)}`,
    expectedRevision: "c".repeat(40),
    network: "net",
    names: { api: "a", worker: "w", scan: "s", web: "x" },
  };
  const spec = (updates) => ({ ...base, updates });
  assert.equal(validateSpec(spec(unsetAll)).updates.length, 4);
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "unset", value: "1" }])),
    /spec_update_value/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "unset", value: "" }])),
    /spec_update_value/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "set", value: "" }])),
    /spec_update_value/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "set" }])),
    /spec_update_value/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "delete" }])),
    /spec_update_shape/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "a", op: "unset" }])),
    /spec_update_shape/,
  );
  assert.throws(
    () => validateSpec(spec([{ key: "AB", op: "unset", roles: ["db"] }])),
    /spec_update_roles/,
  );
  assert.throws(() => validateSpec(spec([])), /spec_updates/);
});

test("without unset the env list and canonical file are byte-for-byte what they were", () => {
  const env = new Map([
    ["A", "1"],
    ["B", "2"],
  ]);
  const updates = roleUpdates("api", env, [
    { key: "B", op: "set", value: "9" },
    { key: "C", op: "add", value: "3" },
  ]);
  assert.deepEqual(applyEnvList(["A=1", "B=2"], updates), [
    "A=1",
    "B=9",
    "C=3",
  ]);
  assert.equal(applyCanonical("A=1\nB=2\n", env, updates), "A=1\nB=9\nC=3\n");
});

test("unset of a key the image sets through ENV is refused before anything runs", () => {
  const imageEnv = ["PATH=/usr/bin", "NODE_ENV=production"];
  assert.doesNotThrow(() => requireUnsetOutsideImageEnv(unsetAll, imageEnv));
  assert.throws(
    () =>
      requireUnsetOutsideImageEnv([{ key: "NODE_ENV", op: "unset" }], imageEnv),
    /unset_key_in_image_env:NODE_ENV/,
  );
  // Only unset is affected: overriding an image ENV value with set stays allowed.
  assert.doesNotThrow(() =>
    requireUnsetOutsideImageEnv(
      [{ key: "NODE_ENV", op: "set", value: "test" }],
      imageEnv,
    ),
  );
});
