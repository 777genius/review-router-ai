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
