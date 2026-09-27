import { describe, expect, it } from "vitest";
import {
  anchor,
  assertTargetDatabase,
  planProductionAdditiveMigrations,
  stripMigrationTransaction,
  targetMigrations,
} from "./production-additive-migration-window.mjs";

const catalog = ["000105_prior", anchor, ...targetMigrations];
const checksums = new Map(catalog.map((name) => [name, `${name}-sha`]));
const applied = (name: string) => ({
  migration_name: name,
  checksum: checksums.get(name),
  finished_at: new Date(),
  rolled_back_at: null,
});

describe("production additive migration window", () => {
  it("admits only the exact production database", () => {
    expect(() =>
      assertTargetDatabase(
        "postgresql://role:secret@dpg-da32ipmk1f9s73dttm90-a.frankfurt-postgres.render.com/review_router_dimy",
        "review_router_dimy",
      ),
    ).not.toThrow();
    expect(() =>
      assertTargetDatabase(
        "postgresql://role:secret@other-db.frankfurt-postgres.render.com/review_router_dimy",
        "review_router_dimy",
      ),
    ).toThrow("production_migration_database_identity_mismatch");
  });

  it("permits a contiguous migration prefix and proves postflight completion", () => {
    const rows = [
      applied(catalog[0]),
      applied(anchor),
      applied(targetMigrations[0]),
    ];
    expect(
      planProductionAdditiveMigrations({ catalog, rows, checksums }).pending,
    ).toEqual(targetMigrations.slice(1));
    expect(() =>
      planProductionAdditiveMigrations({
        catalog,
        rows,
        checksums,
        postflight: true,
      }),
    ).toThrow("production_migration_postflight_incomplete");
    expect(
      planProductionAdditiveMigrations({
        catalog,
        rows: catalog.map(applied),
        checksums,
        postflight: true,
      }).pending,
    ).toEqual([]);
  });

  it("rejects drift, a failed migration, and altered migration bytes", () => {
    expect(() =>
      planProductionAdditiveMigrations({
        catalog: [...catalog, "000111_unrelated"],
        rows: [applied(catalog[0]), applied(anchor)],
        checksums,
      }),
    ).toThrow("production_migration_catalog_outside_window");
    expect(() =>
      planProductionAdditiveMigrations({
        catalog,
        rows: [
          applied(catalog[0]),
          applied(anchor),
          applied(targetMigrations[1]),
        ],
        checksums,
      }),
    ).toThrow("production_migration_ledger_outside_window");
    expect(() =>
      planProductionAdditiveMigrations({
        catalog,
        rows: [
          applied(catalog[0]),
          applied(anchor),
          { ...applied(targetMigrations[0]), finished_at: null },
        ],
        checksums,
      }),
    ).toThrow("production_migration_ledger_outside_window");
    expect(() =>
      planProductionAdditiveMigrations({
        catalog,
        rows: [
          applied(catalog[0]),
          applied(anchor),
          { ...applied(targetMigrations[0]), checksum: "wrong" },
        ],
        checksums,
      }),
    ).toThrow("production_migration_checksum_mismatch");
    expect(() =>
      planProductionAdditiveMigrations({
        catalog,
        rows: [applied(anchor)],
        checksums,
      }),
    ).toThrow("production_migration_ledger_outside_window");
  });

  it("strips only a whole-file transaction envelope", () => {
    expect(
      stripMigrationTransaction(
        "-- comment\nBEGIN;\nSELECT 1;\nCOMMIT;\n",
        "target",
      ),
    ).toBe("-- comment\nSELECT 1;\n");
    expect(() =>
      stripMigrationTransaction("SELECT 1;\nCOMMIT;", "target"),
    ).toThrow("production_migration_transaction_envelope_invalid");
  });
});
