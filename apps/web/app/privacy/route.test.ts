// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { GET } from "./route";

const webRoot = resolve(process.cwd(), "apps/web");

afterEach(() => vi.restoreAllMocks());

async function privacyDocument(): Promise<Document> {
  vi.spyOn(process, "cwd").mockReturnValue(webRoot);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
  return new DOMParser().parseFromString(await response.text(), "text/html");
}

describe("Public Privacy response", () => {
  it("discloses Memory confirmation and the actual credential and findings boundary", async () => {
    const page = await privacyDocument();
    const text = page.querySelector("main")?.textContent?.replace(/\s+/g, " ");
    expect(page.querySelector("h1")?.textContent).toBe("Privacy policy");
    expect(text).toContain("not active runtime memory until approved");
    expect(text).toContain(
      "Authorized maintainers or administrators confirm shared guidance",
    );
    expect(text).toContain("Normalized findings may contain source excerpts");
    expect(text).toContain(
      "store provider credentials encrypted on the server",
    );
  });

  it("documents runtime removal and redaction before maintenance deletion", async () => {
    const page = await privacyDocument();
    const text = page.querySelector("main")?.textContent?.replace(/\s+/g, " ");
    expect(text).toContain(
      "Disabling or deleting Memory removes it from runtime retrieval",
    );
    expect(text).toContain("Deletion redacts the stored item");
    expect(text).toContain("before later maintenance pruning");
    expect(text).toContain("Deleted Memory is excluded from Memory exports");
    expect(
      page.querySelector('a[href="mailto:quantjumppro@gmail.com"]'),
    ).toBeTruthy();
  });
});
