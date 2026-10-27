import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryPreviewPage from "./page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("preview-not-found");
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe("memory preview", () => {
  it("keeps the preview behind its existing environment guard", () => {
    vi.stubEnv("REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW", "0");
    expect(() => MemoryPreviewPage()).toThrow("preview-not-found");
  });

  it("renders the real screen with a visibly isolated preview when enabled", () => {
    vi.stubEnv("REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW", "1");
    const html = renderToStaticMarkup(MemoryPreviewPage());
    expect(html).toContain("changes stay in this preview");
    expect(html).toContain("Use parameterized queries");
    expect(html).toContain("Add memory");
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html).not.toContain("Policy simulator");
  });
});
