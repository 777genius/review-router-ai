import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { GET as v1GET } from "../v1.svg/route";

const request = (query: string, headers?: HeadersInit) =>
  new Request(
    `https://reviewrouter.test/review-banner/v2.svg?${query}`,
    headers ? { headers } : {},
  );
const first = "state=complete&variant=first";
const update =
  "state=complete&variant=update&new=1&resolved=2&open=1&unverified=0";

describe("review banner v2", () => {
  it("renders the English unbranded Action first design using only measured facts", async () => {
    const response = GET(
      request(`${first}&critical=1&reviewed=12&total=12&theme=light`),
    );
    const svg = await response.text();
    expect(svg).toContain("REVIEW COMPLETE");
    expect(svg).toContain("1 critical issue needs attention");
    expect(svg).toContain("12 / 12 files reviewed");
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('viewBox="0 0 1200 280"');
    expect(svg).not.toMatch(
      /ReviewRouter|Customer|merg|commit|<script|foreignObject|href=|<image|@import/,
    );
    const unknownCoverage = await GET(request(first)).text();
    expect(unknownCoverage).toContain("No issues found");
    expect(unknownCoverage).not.toContain("files reviewed");
  });

  it("renders trusted update counts with correct singular/plural and zero wording", async () => {
    const svg = await GET(request(update)).text();
    expect(svg).toContain("REVIEW UPDATED");
    expect(svg).toContain("2 issues resolved.");
    expect(svg).toContain("1 still needs a fix.");
    expect(svg).toContain("1 new");
    expect(svg).toContain("2 resolved");
    expect(svg).toContain("1 open");
    expect(svg).not.toContain("0 unverified");
    const clean = await GET(
      request(
        "state=complete&variant=update&new=0&resolved=1&open=0&unverified=0",
      ),
    ).text();
    expect(clean).toContain("1 issue resolved.");
    expect(clean).toContain("No open issues.");
    const empty = await GET(
      request(
        "state=complete&variant=update&new=0&resolved=0&open=0&unverified=0",
      ),
    ).text();
    expect(empty).toContain("No open issues");
    expect(empty).not.toContain("0 issues resolved");
    const unverified = await GET(
      request(
        "state=complete&variant=update&new=0&resolved=0&open=1&unverified=1",
      ),
    ).text();
    expect(unverified).toContain("1 issue remains open.");
    expect(unverified).toContain("1 needs verification.");
    expect(unverified).not.toContain("needs a fix");
  });

  it.each(["first", "update"])(
    "never calls an incomplete %s review clean or fully covered",
    async (variant) => {
      const counters =
        variant === "update" ? "&new=0&resolved=0&open=3&unverified=3" : "";
      const svg = await GET(
        request(
          `state=incomplete&variant=${variant}${counters}&reviewed=12&total=12`,
        ),
      ).text();
      expect(svg).toContain("REVIEW INCOMPLETE");
      expect(svg).not.toMatch(
        /REVIEW COMPLETE|REVIEW UPDATED|No issues found|No open issues|Full coverage|files reviewed/,
      );
      expect(svg).toContain("Coverage checked: 12 / 12 files");
      if (variant === "update") {
        expect(svg).toContain("3 unverified");
        expect(svg).toContain("3 open");
        expect(svg).not.toContain("still need a fix");
      }
    },
  );

  it.each([
    "state=clean&variant=first",
    "state=complete&variant=changed",
    `${first}&theme=auto`,
    `${first}&layout=auto`,
    `${first}&critical=-1`,
    `${first}&critical=10000`,
    `${first}&critical=1.5`,
    `${first}&critical=1e2`,
    `${first}&critical=01`,
    `${first}&critical=`,
    `${first}&critical=1&critical=2`,
    `${first}&state=complete`,
    `${first}&lang=en`,
    `${first}&repo=private`,
    `${first}&title=%3Cscript%3E`,
    `${first}&reviewed=1`,
    `${first}&total=2`,
    `${first}&reviewed=3&total=2`,
    `${first}&reviewed=0&total=10000`,
    `${first}&new=0&resolved=0&open=0&unverified=0`,
    "state=complete&variant=update",
    "state=complete&variant=update&new=0&resolved=0&open=0",
    "state=complete&variant=update&new=2&resolved=0&open=1&unverified=0",
    "state=complete&variant=update&new=0&resolved=0&open=1&unverified=2",
    `${first}&unknown=${"x".repeat(2_100)}`,
    "variant=first",
    "state=complete",
  ])("rejects invalid or inconsistent query: %s", async (query) => {
    const response = GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("Invalid banner parameters");
  });

  it("keeps optional zero coverage distinct from absent coverage and handles max counts in both layouts/themes", async () => {
    const zero = await GET(request(`${first}&reviewed=0&total=0`)).text();
    expect(zero).toContain("0 / 0 files reviewed");
    for (const theme of ["light", "dark"])
      for (const layout of ["wide", "compact"]) {
        const svg = await GET(
          request(
            `state=incomplete&variant=update&critical=9999&major=9999&minor=9999&info=9999&new=9999&resolved=9999&open=9999&unverified=9999&reviewed=9999&total=9999&theme=${theme}&layout=${layout}`,
          ),
        ).text();
        expect(Buffer.byteLength(svg)).toBeLessThan(8_000);
        expect(svg).not.toMatch(
          /undefined|NaN|ReviewRouter|href=|<script|foreignObject/,
        );
        expect(svg).toContain(
          layout === "wide"
            ? 'viewBox="0 0 1200 280"'
            : 'viewBox="0 0 480 360"',
        );
        expect(svg).toContain("9999 unverified");
      }
  });

  it("has deterministic bounded SVG, secure caching and conditional validation without altering v1", async () => {
    const response = GET(request(`${first}&major=2`));
    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("cache-control")).toContain("immutable");
    const etag = response.headers.get("etag")!;
    expect(await GET(request(`major=2&${first}`)).text()).toBe(
      await response.text(),
    );
    for (const validator of [
      etag,
      `W/${etag}`,
      `"other,*,also", W/${etag}`,
      "*",
    ]) {
      const cached = GET(
        request(`${first}&major=2`, { "If-None-Match": validator }),
      );
      expect(cached.status).toBe(304);
      expect(await cached.text()).toBe("");
    }
    expect(
      GET(request(`${first}&major=2`, { "If-None-Match": '"other,*,also"' }))
        .status,
    ).toBe(200);
    expect(
      GET(request(`${first}&major=2&theme=light`)).headers.get("etag"),
    ).not.toBe(etag);
    const legacy = await v1GET(
      new Request(
        "https://reviewrouter.test/review-banner/v1.svg?state=complete&critical=1",
      ),
    ).text();
    expect(legacy).toContain("ReviewRouter");
    expect(legacy).toContain('width="640"');
  });
});
