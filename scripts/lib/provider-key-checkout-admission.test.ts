import { describe, expect, it } from "vitest";
import {
  partitionRenderSchemaHandoffCheckout,
  readRenderManagedCheckoutInventory,
} from "./render-schema-handoff-policy.mjs";
import { readRenderHistorical96CheckoutInventory } from "./render-historical96-checkout.mjs";

const keyName = "000110_provider_api_key_workspace_management";
const predecessor = "000109_sdk_growth_verifier_assignment_lock";
const originalHistory = readRenderManagedCheckoutInventory().filter(
  (row) => row.migrationName !== keyName,
);
const key = {
  migrationName: keyName,
  checksum: "d69beaa182fd49ad231bb86b2af4b9d53af3c54cab3a12fa3ca910e7a4379208",
};
const withKey = (rows: typeof originalHistory) =>
  [...rows, key].sort((a, b) => a.migrationName.localeCompare(b.migrationName));

describe("provider key checkout admission preserves historical authority", () => {
  it("admits the exact key addition without enlarging managed92 or historical96", () => {
    const combined = withKey(originalHistory);
    expect(partitionRenderSchemaHandoffCheckout(combined)).toEqual(
      partitionRenderSchemaHandoffCheckout(originalHistory),
    );
    expect(partitionRenderSchemaHandoffCheckout(combined)).toHaveLength(92);
    expect(readRenderHistorical96CheckoutInventory()).toHaveLength(96);
    expect(combined).toHaveLength(originalHistory.length + 1);
  });

  it("also validates the exact predecessor checkout with the key addition", () => {
    const prefix = originalHistory.filter(
      (row) => row.migrationName <= predecessor,
    );
    expect(partitionRenderSchemaHandoffCheckout(withKey(prefix))).toEqual(
      partitionRenderSchemaHandoffCheckout(prefix),
    );
  });

  it.each([
    [
      "wrong key checksum",
      () =>
        withKey(originalHistory).map((row) =>
          row.migrationName === keyName
            ? { ...row, checksum: "0".repeat(64) }
            : row,
        ),
    ],
    [
      "missing predecessor",
      () =>
        withKey(
          originalHistory.filter((row) => row.migrationName !== predecessor),
        ),
    ],
    ["duplicate key", () => withKey([...originalHistory, key])],
    [
      "changed original checksum",
      () =>
        withKey(
          originalHistory.map((row) =>
            row.migrationName === predecessor
              ? { ...row, checksum: "0".repeat(64) }
              : row,
          ),
        ),
    ],
    [
      "missing original middle migration",
      () =>
        withKey(
          originalHistory.filter(
            (row) =>
              row.migrationName !== "000108_sdk_growth_verifier_assignment",
          ),
        ),
    ],
    [
      "unknown future migration",
      () =>
        withKey([
          ...originalHistory,
          {
            migrationName: "000999_unreviewed_checkout",
            checksum: "0".repeat(64),
          },
        ]),
    ],
  ] as const)("rejects %s", (_label, rows) => {
    expect(() => partitionRenderSchemaHandoffCheckout(rows())).toThrow();
  });
});
