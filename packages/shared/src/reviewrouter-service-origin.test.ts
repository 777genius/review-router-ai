import { expect, it } from "vitest";
import { reviewRouterApiUrlsMatch } from "./reviewrouter-service-origin";

it("accepts only the two normalized owned API origins as aliases in both directions", () => {
  const primary = "https://api.reviewrouter.org";
  const retained = "https://api.reviewrouter.site";
  expect(reviewRouterApiUrlsMatch(primary, retained)).toBe(true);
  expect(reviewRouterApiUrlsMatch(retained, primary)).toBe(true);
  for (const other of [
    "https://api.reviewrouter.site.attacker.test",
    "https://api.reviewrouter.site:8443",
    "https://api.reviewrouter.site/path",
    "https://api.reviewrouter.site?next=org",
    "https://api.reviewrouter.site#org",
    "https://user@api.reviewrouter.site",
    "http://api.reviewrouter.site",
    "https://custom.example",
  ]) {
    expect(reviewRouterApiUrlsMatch(other, primary)).toBe(false);
    expect(reviewRouterApiUrlsMatch(primary, other)).toBe(false);
  }
  expect(
    reviewRouterApiUrlsMatch(
      "https://custom.example",
      "https://custom.example",
    ),
  ).toBe(true);
  expect(
    reviewRouterApiUrlsMatch("https://other.example", "https://custom.example"),
  ).toBe(false);
});
