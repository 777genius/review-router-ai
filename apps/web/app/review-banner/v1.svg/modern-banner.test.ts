import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { GET } from "./route";
import { GET as v2GET } from "../v2.svg/route";

const request = (query: string, headers?: HeadersInit) =>
  new Request(
    `https://reviewrouter.test/review-banner/v1.svg?${query}`,
    headers ? { headers } : {},
  );
const first = "state=complete&variant=first";
const update =
  "state=complete&variant=update&new=1&resolved=2&open=1&unverified=0";

describe("canonical modern review banner", () => {
  it.each([
    [
      "state=complete&variant=first&major=2",
      "997835b00b58d20bd1f2cd44146c56e3a62dfe14a4a5e5596561f371941e41af",
    ],
    [
      "state=complete&variant=update&new=1&resolved=2&open=1&unverified=0",
      "ba86bb225e06e25595e6f28aa37ed35345aa89fd5389d8c5d3edcbdcc1518eb4",
    ],
    [
      "state=complete&lang=en&theme=dark",
      "871f944a7617f03bc3ff6cb91e5d14efe95bb87ca42528f12f3f2a5912b7167f",
    ],
  ])(
    "preserves installed no-extension SVG bytes: %s",
    async (query, digest) => {
      expect(
        createHash("sha256")
          .update(await GET(request(query)).text())
          .digest("hex"),
      ).toBe(digest);
    },
  );

  it.each(["light", "dark", "auto"])(
    "renders review-time verification without native closure claims in %s",
    async (theme) => {
      for (const layout of ["wide", "compact"]) {
        const fixes = await GET(
          request(
            `state=complete&variant=update&new=0&resolved=0&open=0&unverified=0&verified=4&not_verified=0&confirmed_open=0&theme=${theme}&layout=${layout}`,
          ),
        ).text();
        expect(fixes).toContain("4 fixes verified");
        expect(fixes).toContain("Thread closure counted separately");
        expect(fixes).toContain("0 resolved");
        expect(fixes).not.toMatch(
          /No open issues|No issues found|4 (?:issues )?resolved/,
        );
        const unknown = await GET(
          request(
            `state=complete&variant=first&verified=0&not_verified=4&confirmed_open=0&theme=${theme}&layout=${layout}`,
          ),
        ).text();
        expect(unknown).toContain("4 previous issues not verified");
        expect(unknown).toContain("VERIFICATION INCOMPLETE");
        expect(unknown).not.toMatch(
          /REVIEW COMPLETE|No issues found|No open issues/,
        );
        const mixed = await GET(
          request(
            `state=complete&variant=update&new=1&resolved=0&open=2&unverified=0&minor=1&major=1&verified=2&not_verified=1&confirmed_open=1&theme=${theme}&layout=${layout}`,
          ),
        ).text();
        const headlines = [
          ...mixed.matchAll(
            /<text[^>]*letter-spacing="-0.6"[^>]*>([^<]*)<\/text>/g,
          ),
        ].map((match) => match[1]);
        expect(headlines).toEqual(["1 new issue found", "2 fixes verified"]);
        expect(mixed).toContain("1 previous issue not verified");
        expect(mixed).toContain("0 resolved");
        expect(mixed).not.toMatch(
          /No open issues|No issues found|2 (?:issues )?resolved/,
        );
        for (const svg of [fixes, unknown, mixed]) {
          const metricLabels = [
            ...svg.matchAll(
              /<text[^>]* y="(?:255|277|325)"[^>]*>([^<]*)<\/text>/g,
            ),
          ].map((match) => match[1]);
          expect(metricLabels.length).toBeLessThanOrEqual(4);
          expect(svg).toContain(
            layout === "wide"
              ? 'viewBox="0 0 1200 280"'
              : 'viewBox="0 0 480 360"',
          );
          if (layout === "wide") expect(svg).toContain('id="brandLogo"');
          else expect(svg).not.toContain('id="brandLogo"');
        }
      }
    },
  );

  it.each([
    ["light", "#ad2333", "#fff2f1", "#7d4e00", "#fff8e6"],
    ["dark", "#ff8f96", "#27191f", "#e3b341", "#292317"],
  ])(
    "keeps current critical priority above old verification uncertainty in %s",
    async (theme, red, tint, amber, warningTint) => {
      for (const layout of ["wide", "compact"])
        for (const variant of ["first", "update"]) {
          const updates =
            variant === "update" ? "&new=1&resolved=0&open=1&unverified=0" : "";
          const query = `state=complete&variant=${variant}${updates}&critical=1&verified=2&not_verified=1&confirmed_open=0&theme=${theme}&layout=${layout}`;
          const svg = await GET(request(query)).text();
          expect(svg).toContain(
            `<linearGradient id="background"><stop stop-color="${tint}"`,
          );
          if (variant === "first")
            expect(svg).toContain(`stroke="${red}" stroke-width="4"`);
          else {
            expect(
              svg.match(/<text[^>]*fill="([^"]+)"[^>]*>1 new<\/text>/)?.[1],
            ).toBe(red);
            expect(svg).toContain("1 new issue found");
          }
          expect(svg).toContain("2 fixes verified");
          expect(svg).toContain("1 previous issue not verified");
          const partial = await GET(
            request(query.replace("state=complete", "state=incomplete")),
          ).text();
          expect(partial).toContain(
            `<linearGradient id="background"><stop stop-color="${warningTint}"`,
          );
          const unknown = await GET(
            request(
              `state=complete&variant=first&verified=0&not_verified=1&confirmed_open=0&theme=${theme}&layout=${layout}`,
            ),
          ).text();
          expect(unknown).toContain(`stroke="${amber}" stroke-width="4"`);
          expect(unknown).toContain(
            `<linearGradient id="background"><stop stop-color="${warningTint}"`,
          );
        }
    },
  );

  it("retains verified fixes with partial discovery and keeps receipt-backed resolved counts separate", async () => {
    const incomplete = await GET(
      request(
        "state=incomplete&variant=update&new=0&resolved=0&open=0&unverified=0&verified=2&not_verified=0&confirmed_open=0",
      ),
    ).text();
    expect(incomplete).toContain("2 fixes verified");
    expect(incomplete).toContain("REVIEW INCOMPLETE");
    expect(incomplete).not.toMatch(/No issues found|No open issues/);
    const later = await GET(
      request(
        "state=complete&variant=update&new=0&resolved=2&open=0&unverified=0&verified=1&not_verified=0&confirmed_open=0",
      ),
    ).text();
    expect(later).toContain("1 fix verified");
    expect(later).toContain("2 issues resolved");
    expect(later).not.toContain("3 issues resolved");
  });

  const pairedSource =
    process.env.REVIEW_ROUTER_ACTION_SOURCE_DIR ??
    process.env.REVIEW_ROUTER_PAIRED_ACTION_REPO;
  it.skipIf(!pairedSource)(
    "roundtrips actual paired projection facts and banner URLs through SVG rendering",
    async () => {
      const [{ renderReviewBanner }, { deriveReviewPresentation }] =
        await Promise.all([
          import(
            pathToFileURL(
              path.join(pairedSource!, "src/output/review-banner.ts"),
            ).href
          ),
          import(
            pathToFileURL(
              path.join(
                pairedSource!,
                "src/review-projection/domain/review-presentation.ts",
              ),
            ).href
          ),
        ]);
      const coverage = {
        state: "complete",
        mode: "full",
        totalFiles: 1,
        reviewedFiles: 1,
        unreviewedFiles: 0,
        limitations: [],
      };
      const facts = (
        count: number,
        state: "fix_confirmed_thread_open" | "unverified",
        mode: "report_only" | "pending" = "report_only",
      ) =>
        Array.from({ length: count }, (_, index) => ({
          targetId: `target-${index}`,
          semanticVerdict: state === "unverified" ? "uncertain" : "resolved",
          confirmationState: state,
          severity: "major",
          observationIds:
            state === "unverified" ? [] : ["accepted-observation"],
          providerVoteKeys: state === "unverified" ? [] : ["verifier"],
          reasonCodes: [],
          mutationStatus: state === "unverified" ? "not_eligible" : mode,
        }));
      const presentations = ["report_only", "pending"].flatMap((mode) =>
        [true, false].map((withBaseline) =>
          deriveReviewPresentation({
            reviewedHeadSha: "b".repeat(40),
            ...(withBaseline
              ? {
                  baseline: {
                    sourceReviewedHeadSha: "a".repeat(40),
                    priorLineageHints: [],
                  },
                }
              : {}),
            coverage,
            incomplete: false,
            occurrences: [],
            lifecycleVerificationFacts: facts(
              4,
              "fix_confirmed_thread_open",
              mode as "report_only" | "pending",
            ),
          }),
        ),
      );
      presentations.push(
        deriveReviewPresentation({
          reviewedHeadSha: "b".repeat(40),
          coverage,
          incomplete: true,
          occurrences: [],
          lifecycleVerificationFacts: facts(4, "unverified"),
        }),
      );
      for (const incomplete of [false, true])
        presentations.push(
          deriveReviewPresentation({
            reviewedHeadSha: "b".repeat(40),
            baseline: {
              sourceReviewedHeadSha: "a".repeat(40),
              priorLineageHints: [],
            },
            coverage,
            incomplete,
            occurrences: [
              { lineageId: "new-minor", state: "new", severity: "minor" },
            ],
            lifecycleVerificationFacts: [
              ...facts(2, "fix_confirmed_thread_open", "pending"),
              { ...facts(1, "unverified")[0], targetId: "uncertain-target" },
              {
                targetId: "confirmed-target",
                semanticVerdict: "still_valid",
                confirmationState: "confirmed_open",
                severity: "major",
                observationIds: ["accepted-confirmation"],
                providerVoteKeys: ["verifier"],
                reasonCodes: [],
                mutationStatus: "not_eligible",
              },
            ],
          }),
        );
      for (const presentation of presentations) {
        const html = renderReviewBanner(
          "https://reviewrouter.test",
          presentation,
        );
        const urls = [...html.matchAll(/(?:src|srcset)="([^"]+)"/g)].map(
          (match) => new URL(String(match[1]).replaceAll("&amp;", "&")),
        );
        expect(urls).toHaveLength(2);
        for (const url of urls)
          for (const theme of ["light", "dark", "auto"]) {
            url.searchParams.set("theme", theme);
            const response = GET(new Request(url));
            expect(response.status).toBe(200);
            const svg = await response.text();
            expect(svg).toContain(
              presentation.verification.fixesVerified
                ? `${presentation.verification.fixesVerified} fixes verified`
                : "4 previous issues not verified",
            );
            if (presentation.changes?.new === 1) {
              const headlines = [
                ...svg.matchAll(
                  /<text[^>]*letter-spacing="-0.6"[^>]*>([^<]*)<\/text>/g,
                ),
              ].map((match) => match[1]);
              expect(headlines).toEqual([
                "1 new issue found",
                "2 fixes verified",
              ]);
              expect(svg).toContain("1 previous issue not verified");
            }
            expect(svg).not.toMatch(
              /No issues found|No open issues|4 (?:issues )?resolved/,
            );
            if (presentation.changes)
              expect(presentation.changes.resolved).toBe(0);
            const aliasUrl = new URL(url);
            aliasUrl.pathname = "/review-banner/v2.svg";
            const alias = v2GET(new Request(aliasUrl));
            expect(await alias.text()).toBe(svg);
          }
      }
    },
  );

  it("renders the approved English first design with a local vector logo only in wide layout", async () => {
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
      /ReviewRouter|Customer|merg|commit|<script|foreignObject|<image|@import/,
    );
    expect(svg).toContain('id="brandLogo"');
    expect(svg).toContain('id="logoHalo"');
    expect(
      [...svg.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    ).toEqual(["#brandLogo", "#brandLogo"]);
    const compact = await GET(
      request(`${first}&critical=1&layout=compact`),
    ).text();
    expect(compact).toContain('viewBox="0 0 480 360"');
    expect(compact).not.toMatch(/brandLogo|logoHalo|href=|<image/);
    const unknownCoverage = await GET(request(first)).text();
    expect(unknownCoverage).toContain("No issues found");
    expect(unknownCoverage).not.toContain("files reviewed");
  });

  it("renders trusted update counts with correct singular/plural and zero wording", async () => {
    const svg = await GET(request(update)).text();
    expect(svg).toContain("REVIEW UPDATED");
    expect(svg).toContain("1 new issue found");
    expect(svg).toContain("2 issues resolved");
    expect(svg).toContain("1 new");
    expect(svg).toContain("2 resolved");
    expect(svg).toContain("1 confirmed open");
    expect(svg).not.toContain("0 unverified");
    const clean = await GET(
      request(
        "state=complete&variant=update&new=0&resolved=1&open=0&unverified=0",
      ),
    ).text();
    expect(clean).toContain("1 issue resolved");
    expect(clean).toContain("No open issues");
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
    expect(unverified).toContain("No new issues found");
    expect(unverified).toContain("1 previous issue not verified");
    expect(
      unverified.match(/<title id="title">([^<]*)<\/title>/)?.[1],
    ).toContain("1 previous issue not verified");
    expect(unverified).not.toMatch(
      /remains open|needs verification|included in open/,
    );
    expect(unverified).not.toContain("needs a fix");
    const auto = await GET(request(`${update}&theme=auto`)).text();
    expect(auto).toContain('fill="var(--resolved,#1a7f37)"');
    expect(auto).toContain("--resolved:#7ee787");
  });

  it.each(["wide", "compact"])(
    "prioritizes the new finding and separates unchecked prior issues in %s layout",
    async (layout) => {
      const svg = await GET(
        request(
          `state=complete&variant=update&new=1&resolved=0&open=5&unverified=4&critical=2&major=1&minor=2&layout=${layout}`,
        ),
      ).text();
      expect(svg).toContain("1 new issue found");
      expect(svg).toContain("4 previous issues not verified");
      expect(svg.match(/<title id="title">([^<]*)<\/title>/)?.[1]).toContain(
        "4 previous issues not verified",
      );
      expect(svg).toContain("1 confirmed open");
      expect(svg).not.toMatch(
        /5 open|5 issues remain open|need verification|included in open/,
      );
    },
  );

  it.each(["wide", "compact"])(
    "adapts the %s auto palette to the embedding page without changing layout",
    async (layout) => {
      const query = `${first}&critical=1&major=2&minor=3&info=4&theme=auto&layout=${layout}`;
      const response = GET(request(query));
      expect(response.status).toBe(200);
      const svg = await response.text();
      expect(svg).toContain('fill="var(--ink,#1f2328)"');
      expect(svg).toContain('stop-color="var(--background,#f6f8fa)"');
      expect(svg).toContain("--ink:#1f2328");
      expect(svg).toContain("--background:#f6f8fa");
      expect(svg).toContain("@media (prefers-color-scheme: dark){:root{");
      expect(svg).toContain("--ink:#f0f3f6");
      expect(svg).toContain("--background:#151b23");
      expect(svg).toContain("--critical:#ad2333");
      expect(svg).toContain("--critical:#ff8f96");
      expect(svg).toContain("--major:#7d4e00");
      expect(svg).toContain("--major:#e3b341");
      expect(svg.match(/<svg /g)).toHaveLength(1);
      expect(svg.match(/<style>/g)).toHaveLength(1);
      expect(svg).not.toMatch(/@import|<script|<image/);
      if (layout === "wide") {
        expect(svg.match(/id="brandLogo"/g)).toHaveLength(1);
        expect(svg).toContain("--halo-opacity:.09");
        expect(svg).toContain("--halo-opacity:.14");
      } else {
        expect(svg).not.toContain("brandLogo");
      }
      const alias = v2GET(
        new Request(`https://reviewrouter.test/review-banner/v2.svg?${query}`),
      );
      expect(alias.status).toBe(200);
      expect(await alias.text()).toBe(svg);
      expect(alias.headers.get("etag")).toBe(response.headers.get("etag"));
      for (const theme of ["light", "dark"]) {
        const explicit = GET(
          request(query.replace("theme=auto", `theme=${theme}`)),
        );
        expect(await explicit.text()).not.toContain("<style>");
        expect(explicit.headers.get("etag")).not.toBe(
          response.headers.get("etag"),
        );
      }
    },
  );

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
        expect(svg).toContain("3 not verified");
        expect(svg).toContain("3 previous issues not verified");
        expect(svg).not.toContain("3 known issues still open");
        expect(svg).not.toContain("still need a fix");
      }
    },
  );

  it("distinguishes informational, major and incomplete-zero states without a false pass", async () => {
    const info = await GET(request(`${first}&info=2`)).text();
    expect(info).toContain("2 informational notes");
    expect(info).toContain("No critical, major or minor issues found");
    expect(info).not.toContain("needs attention");
    const major = await GET(request(`${first}&major=1`)).text();
    expect(major).toContain("1 major issue needs attention");
    expect(major).toContain('stroke="#e3b341"');
    expect(major).not.toContain('stroke="#ff8f96"');
    for (const layout of ["compact", "wide"]) {
      const incomplete = await GET(
        request(
          `state=incomplete&variant=update&new=0&resolved=0&open=0&unverified=0&layout=${layout}`,
        ),
      ).text();
      expect(incomplete).toContain("No reliable conclusion yet");
      expect(incomplete).not.toMatch(
        /No issues found|No open issues|0 open|0 resolved|0 new|REVIEW COMPLETE/,
      );
    }
    for (const svg of [info, major]) {
      const headlines = [
        ...svg.matchAll(
          /<text[^>]*letter-spacing="-0.6"[^>]*>([^<]*)<\/text>/g,
        ),
      ].map((match) => match[1]!);
      expect(headlines.length).toBeGreaterThan(0);
      expect(headlines.every((text) => !text.endsWith("."))).toBe(true);
    }
  });

  it.each([
    "state=clean&variant=first",
    "state=complete&variant=changed",
    `${first}&verified=1`,
    `${first}&verified=1&not_verified=0`,
    `${first}&verified=-1&not_verified=0&confirmed_open=0`,
    `${first}&verified=10000&not_verified=0&confirmed_open=0`,
    `${first}&verified=0&not_verified=NaN&confirmed_open=0`,
    `${first}&verified=0&not_verified=0&confirmed_open=1.5`,
    `${first}&verified=0&not_verified=0&confirmed_open=0&verified=1`,
    `${first}&theme=system`,
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
  ])("rejects invalid or inconsistent query: %s", async (query) => {
    const response = GET(request(query, { "If-None-Match": "*" }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("etag")).toBe(false);
    expect(await response.text()).toBe("Invalid banner parameters");
  });

  it("keeps optional zero coverage distinct from absent coverage and handles max counts in both layouts/themes", async () => {
    const zero = await GET(request(`${first}&reviewed=0&total=0`)).text();
    expect(zero).toContain("0 / 0 files reviewed");
    for (const theme of ["light", "dark", "auto"])
      for (const layout of ["wide", "compact"]) {
        const svg = await GET(
          request(
            `state=incomplete&variant=update&critical=9999&major=9999&minor=9999&info=9999&new=9999&resolved=9999&open=9999&unverified=9999&reviewed=9999&total=9999&theme=${theme}&layout=${layout}`,
          ),
        ).text();
        expect(Buffer.byteLength(svg)).toBeLessThan(
          layout === "wide" ? 16_000 : 8_000,
        );
        expect(svg).not.toMatch(
          /undefined|NaN|ReviewRouter|<script|foreignObject/,
        );
        expect(svg).toContain(
          layout === "wide"
            ? 'viewBox="0 0 1200 280"'
            : 'viewBox="0 0 480 360"',
        );
        expect(svg).toContain("9999 not verified");
      }
  });

  it("has deterministic SVG, browser/CDN cache controls and identical v2 compatibility output", async () => {
    const response = GET(request(`${first}&major=2`));
    expect(response.headers.get("content-type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=86400",
    );
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
    const compatibility = v2GET(
      new Request(
        `https://reviewrouter.test/review-banner/v2.svg?${first}&major=2`,
      ),
    );
    expect(compatibility.headers.get("etag")).toBe(etag);
    expect(await compatibility.text()).toBe(
      await GET(request(`${first}&major=2`)).text(),
    );
  });
});
