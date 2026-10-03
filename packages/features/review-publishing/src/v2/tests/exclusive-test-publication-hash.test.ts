import { describe, expect, it } from "vitest";
import { exclusivePublicationHash } from "../infrastructure/exclusive-test-publication-hash";

describe("exclusive publication persisted hash compatibility", () => {
  it("retains canonical UTF-8, bigint and date identity independently of object insertion order", () => {
    // SHA-256 of the existing persisted wire contract, independently pinned:
    // {"nested":[{"$bigint":"7"},{"$date":"2026-10-03T00:00:00.000Z"}],"z":"Привет"}
    const expected =
      "9c68433cb2797a17d87b001f4a8cc2800e9a12f7d733d2041b56ed10cd9f4471";
    const nested = [7n, new Date("2026-10-03T00:00:00.000Z")];
    expect(exclusivePublicationHash({ z: "Привет", nested })).toBe(expected);
    expect(exclusivePublicationHash({ nested, z: "Привет" })).toBe(expected);
    expect(exclusivePublicationHash({ nested, z: "Привет!" })).not.toBe(
      expected,
    );
  });
});
