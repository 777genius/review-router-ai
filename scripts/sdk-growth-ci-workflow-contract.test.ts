import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("SDK PostgreSQL CI suite", () => {
  it("runs the producer identity suite and requires its reported result", () => {
    const workflow = readFileSync(
      new URL("../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    const step = workflow.match(
      /- name: SDK authority and outbox PostgreSQL contracts \(zero skips\)([\s\S]*?)(?=\n {6}- name: |$)/,
    )?.[1];
    expect(step).toBeDefined();
    const suite =
      "apps/api/src/sdk-growth-verifier-producer-identity.pg.test.ts";
    expect(step?.split("--reporter=json")[0]).toContain(suite);
    expect(step?.split("const expected = [")[1]).toContain(`"${suite}"`);
  });
});
