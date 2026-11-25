import { describe, expect, it } from "vitest";
import { restoreOwnedNextEnv } from "./next-generated-env.ts";

const original = [
  '/// <reference types="next" />',
  '/// <reference types="next/image-types/global" />',
  'import "./.next/types/routes.d.ts";',
  'import "./.next/types/root-params.d.ts";',
  "",
  "// NOTE: This file should not be edited",
  "// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.",
  "",
].join("\n");
const statisticsDirectory =
  "./../../tmp/statistics-e2e/run-2026-11-23T20-00-00-000Z-123abc/next-build/dev/types";
const statistics = original.replaceAll("./.next/types", statisticsDirectory);

describe("owned Next generated metadata restoration", () => {
  it("preserves unchanged metadata", () => {
    expect(restoreOwnedNextEnv(original, original, statisticsDirectory)).toBe(
      original,
    );
  });

  it("restores both imports from the Statistics run's exact directory", () => {
    expect(restoreOwnedNextEnv(original, statistics, statisticsDirectory)).toBe(
      original,
    );
  });

  it("restores both imports emitted by the Skills development server", () => {
    const current = original.replaceAll("./.next/types", "./.next/dev/types");
    expect(restoreOwnedNextEnv(original, current, "./.next/dev/types")).toBe(
      original,
    );
  });

  it("retains the routes-only metadata format", () => {
    const routesOnly = original.replace(
      'import "./.next/types/root-params.d.ts";\n',
      "",
    );
    const current = routesOnly.replace("./.next/types", statisticsDirectory);
    expect(restoreOwnedNextEnv(routesOnly, current, statisticsDirectory)).toBe(
      routesOnly,
    );
  });

  it("preserves CRLF bytes", () => {
    const baseline = original.replaceAll("\n", "\r\n");
    const current = statistics.replaceAll("\n", "\r\n");
    expect(restoreOwnedNextEnv(baseline, current, statisticsDirectory)).toBe(
      baseline,
    );
  });

  it.each([
    ["another run", statistics.replaceAll("123abc", "456def")],
    [
      "another output directory",
      statistics.replaceAll("next-build", "foreign"),
    ],
    [
      "a foreign root-params import",
      statistics.replace(
        `${statisticsDirectory}/root-params.d.ts`,
        "../../foreign/types/root-params.d.ts",
      ),
    ],
    ["additional source", `${statistics}export {};\n`],
    ["a changed notice", statistics.replace("should not", "may")],
    [
      "a changed reference directive",
      statistics.replace('types="next"', 'types="other"'),
    ],
    [
      "a missing generated import",
      statistics.replace(
        `import "${statisticsDirectory}/root-params.d.ts";\n`,
        "",
      ),
    ],
    [
      "an owned path hidden inside a comment",
      statistics.replace(
        `import "${statisticsDirectory}/root-params.d.ts";`,
        `// import "${statisticsDirectory}/root-params.d.ts";`,
      ),
    ],
  ])("rejects %s without approving an overwrite", (_label, current) => {
    expect(() =>
      restoreOwnedNextEnv(original, current, statisticsDirectory),
    ).toThrow("refusing overwrite");
  });
});
