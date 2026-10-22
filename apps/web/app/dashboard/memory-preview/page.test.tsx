import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MemoryPreviewPage from "./page";
import { MemoryDevelopmentNotice } from "../memory-development-notice";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("preview-not-found");
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe("paused memory preview", () => {
  it("keeps the preview behind its existing environment guard", () => {
    vi.stubEnv("REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW", "0");
    expect(() => MemoryPreviewPage()).toThrow("preview-not-found");
  });

  it("cannot enable controls or fixtures when the preview flag is enabled", () => {
    vi.stubEnv("REVIEW_ROUTER_ENABLE_MEMORY_PREVIEW", "1");
    const html = renderToStaticMarkup(MemoryPreviewPage());
    expect(html).toContain(renderToStaticMarkup(<MemoryDevelopmentNotice />));
    expect(html).not.toMatch(/<(?:form|button|input|select|textarea|a)\b/u);
    expect(html).not.toContain("Balanced memory preview");
    expect(html).not.toContain("Policy simulator");
  });
});
