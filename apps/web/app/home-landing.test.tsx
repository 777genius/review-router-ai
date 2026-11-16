import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeBenchmark } from "./home-benchmark";
import { HomeFeatures } from "./home-features";
import { HomeVisualPreview } from "./home-visual-preview";

describe("ReviewRouter landing presentation", () => {
  it("renders concise sample findings without raw diffs or comment bodies", () => {
    const html = renderToStaticMarkup(<HomeVisualPreview />);
    expect(html).toContain("Duplicate request in a loop");
    expect(html).toContain("Error path needs handling");
    expect(html.match(/class="rr-home-finding__severity /g)).toHaveLength(3);
    expect(html).toContain("Illustrative product interaction");
    expect(html).not.toMatch(/<pre(?:\s|>)/);
    expect(html).not.toContain("<code");
    expect(html).toContain("/review-router-logo.png");
  });

  it("keeps upstream benchmark provenance next to the headline numbers", () => {
    const html = renderToStaticMarkup(<HomeBenchmark />);
    expect(html).toContain("9.5×");
    expect(html).toContain("14.7×");
    expect(html).toContain("Alibaba upstream benchmark");
    expect(html).toContain(
      "not independently measured ReviewRouter service speed",
    );
    expect(html).toContain("not billing or runtime telemetry");
  });

  it("keeps honest costs and the numbering-free section headings", () => {
    const html = renderToStaticMarkup(<HomeFeatures />);
    expect(html).not.toMatch(/\d\d \/ /);
    expect(html).toContain("/landing/usage.webp");
    expect(html).toContain("ReviewRouter dashboard screenshots");
    expect(html).toContain(
      "The AI provider you choose receives the review context",
    );
    expect(html).toContain("Self-hosted");
  });
});
