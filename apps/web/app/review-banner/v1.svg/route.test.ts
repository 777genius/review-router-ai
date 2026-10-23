import { describe, expect, it } from "vitest";
import { GET } from "./route";

const request = (params: string, headers?: HeadersInit) =>
  new Request(
    `https://reviewrouter.test/review-banner/v1.svg?${params}`,
    headers ? { headers } : {},
  );

describe("public review banner v1", () => {
  it("returns a deterministic image with only nonzero counts and cache validation", async () => {
    const response = GET(
      request("state=complete&critical=1&minor=2&lang=en&theme=dark"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=86400",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await response.text();
    expect(svg).toContain("1 critical · 2 minor");
    expect(svg).not.toMatch(/major|<script|foreignObject|href=|<image/);
    expect(Buffer.byteLength(svg)).toBeLessThan(4_000);
    const etag = response.headers.get("etag")!;
    const cached = GET(
      request("minor=2&critical=1&theme=dark&lang=en&state=complete", {
        "If-None-Match": `W/${etag}`,
      }),
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    expect(cached.headers.get("etag")).toBe(etag);
  });

  it.each([
    ['"other,*,also"', 200],
    ['"other,*,also", "unrelated"', 200],
    ['"unclosed,*,also', 200],
    ["*", 304],
  ])("preserves quoted commas in If-None-Match: %s", (value, status) => {
    expect(
      GET(request("state=complete", { "If-None-Match": value })).status,
    ).toBe(status);
  });

  it("matches a validator in a list containing a comma-bearing tag", () => {
    const etag = GET(request("state=complete")).headers.get("etag")!;
    expect(
      GET(
        request("state=complete", {
          "If-None-Match": `"other,*,also", W/${etag}`,
        }),
      ).status,
    ).toBe(304);
  });

  it.each([
    "state=complete&critical=-1",
    "state=complete&critical=10000",
    "state=complete&critical=1.5",
    "state=complete&critical=1e2",
    "state=complete&critical=01",
    "state=complete&critical=",
    "state=complete&critical=1&critical=2",
    "state=complete&file=private.ts",
    "state=complete&lang=__proto__",
    "state=complete&lang=constructor",
    "state=complete&theme=auto",
    "state=clean",
    "critical=1",
    "state=complete&lang=%3Cscript%3E",
    `state=complete&x=${"a".repeat(2_100)}`,
  ])(
    "rejects untrusted, duplicate and out-of-range parameters: %s",
    async (params) => {
      const response = GET(request(params));
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("Invalid banner parameters");
    },
  );

  it("keeps incomplete zero-finding results distinct from a completed clean review", async () => {
    const incomplete = await GET(request("state=incomplete&lang=ru")).text();
    expect(incomplete).toContain("Ревью не завершено");
    expect(incomplete).not.toContain("Замечаний нет");
    const clean = await GET(request("state=complete&lang=ru")).text();
    expect(clean).toContain("Замечаний нет");
  });

  it.each(["en", "ru", "uk", "es", "pt", "fr", "de", "it", "zh", "ja", "ko"])(
    "renders both themes for %s with bounded image content",
    async (lang) => {
      const dark = await GET(
        request(
          `state=incomplete&critical=9999&major=9999&minor=9999&info=9999&lang=${lang}&theme=dark`,
        ),
      ).text();
      const light = await GET(
        request(
          `state=incomplete&critical=9999&major=9999&minor=9999&info=9999&lang=${lang}&theme=light`,
        ),
      ).text();
      expect(dark).not.toBe(light);
      expect(dark).toContain('viewBox="0 0 640 110"');
      expect(dark).not.toContain("undefined");
      expect(Buffer.byteLength(dark)).toBeLessThan(4_000);
    },
  );
});
