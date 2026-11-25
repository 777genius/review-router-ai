import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("loads the actual trust-root JSON with Node's production ESM loader", async () => {
  const source = await readFile(
    new URL(
      "./activation-catalog-policy-raw-promotion-trust-root.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const start = source.indexOf("import activationCatalogRawPromotionTrustRootData");
  const end = source.indexOf(";", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const statement = source.slice(start, end + 1);
  expect(statement).toMatch(
    /from "\.\/activation-catalog-policy-raw-promotion-trust-root\.json" with \{\s*type: "json",?\s*\};$/u,
  );
  const dir = await mkdtemp(join(tmpdir(), "rr-runtime-json-"));
  try {
    await copyFile(
      new URL(
        "./activation-catalog-policy-raw-promotion-trust-root.json",
        import.meta.url,
      ),
      join(dir, "activation-catalog-policy-raw-promotion-trust-root.json"),
    );
    await writeFile(
      join(dir, "smoke.mjs"),
      `${statement}\nif (!activationCatalogRawPromotionTrustRootData || typeof activationCatalogRawPromotionTrustRootData.status !== "string") throw new Error("invalid trust-root JSON");\n`,
    );
    const result = spawnSync(process.execPath, [join(dir, "smoke.mjs")], {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
