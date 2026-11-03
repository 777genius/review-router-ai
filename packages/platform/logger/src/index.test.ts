import { describe, expect, it } from "vitest";
import { redactSensitiveText, safeErrorSummary } from "./index";

describe("safeErrorSummary", () => {
  it.each([
    `ghs_${"a".repeat(36)}`,
    `ghs_12345_eyJ${"a".repeat(180)}.${"b".repeat(200)}.${"c".repeat(125)}`,
    `ghs_12345_eyJ${"a-b_".repeat(50)}.${"c_d-".repeat(50)}.${"e-f_".repeat(50)}`,
  ])(
    "fully redacts installation tokens before truncating errors: %#",
    (token) => {
      expect(redactSensitiveText(`Failed '${token}'; retry`)).toBe(
        "Failed '<redacted>'; retry",
      );
      expect(safeErrorSummary(new Error(`Failed '${token}'; retry`))).toBe(
        "Failed '<redacted>'; retry",
      );
    },
  );

  it("redacts common credentials and normalizes whitespace", () => {
    const error = new Error(`request failed for postgresql://user:pass@db/review
Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature
token=secret-value ghp_1234567890abcdef sk-1234567890abcdef`);

    const summary = safeErrorSummary(error);

    expect(summary).toBe(
      "request failed for postgresql://<redacted>@db/review Authorization=<redacted> token=<redacted> <redacted> <redacted>",
    );
    expect(summary).not.toContain("pass");
    expect(summary).not.toContain("secret-value");
  });

  it("redacts PEM blocks and sensitive query parameters", () => {
    const value = `key -----BEGIN PRIVATE KEY-----
private-material
-----END PRIVATE KEY----- url=https://example.test?access_token=abc123&ok=1`;

    expect(redactSensitiveText(value)).toBe(
      "key <redacted> url=https://example.test?access_token=<redacted>&ok=1",
    );
  });

  it("uses a bounded fallback for non-errors", () => {
    expect(
      safeErrorSummary({ unsafe: true }, { fallback: "api_request_failed" }),
    ).toBe("api_request_failed");
    expect(safeErrorSummary("abcdefgh", { maxLength: 4 })).toBe("abcd");
  });
});
