import { describe, expect, it } from "vitest";
import { readAccountModelCatalogEnabled } from "../composition";

describe("account model catalog rollout", () => {
  it("keeps rollout opt-in and lets the shared disable override a legacy enable", () => {
    expect(readAccountModelCatalogEnabled({})).toBe(false);
    expect(
      readAccountModelCatalogEnabled({
        REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED: "1",
      }),
    ).toBe(true);
    expect(
      readAccountModelCatalogEnabled({
        REVIEW_ROUTER_ACCOUNT_MODEL_CATALOG_ENABLED: "1",
      }),
    ).toBe(true);
    for (const disabled of ["0", "", "true", "invalid"]) {
      expect(
        readAccountModelCatalogEnabled({
          REVIEW_ROUTER_ACCOUNT_MODEL_CATALOG_ENABLED: disabled,
          REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED: "1",
        }),
      ).toBe(false);
    }
  });
});
