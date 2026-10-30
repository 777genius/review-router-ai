import test from "node:test";
import assert from "node:assert/strict";
import {
  nextValue,
  roleUpdates,
  applyEnvList,
  applyCanonical,
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
