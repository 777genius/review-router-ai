import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicFile = (name: string): string =>
  readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

describe("public AI-agent discovery", () => {
  it("publishes all three public machine-readable entrypoints", () => {
    for (const name of ["llms.txt", "auth.md", "agents.md"]) {
      const body = publicFile(name);
      expect(body.startsWith("# "), name).toBe(true);
      expect(body.length, name).toBeGreaterThan(200);
      expect(body).not.toContain("<!doctype html>");
    }
  });

  it("links to actual demo OpenAPI without claiming a general agent API", () => {
    const llms = publicFile("llms.txt");
    expect(llms).toContain("https://api.reviewrouter.org/openapi.json");
    expect(llms).toContain("https://api.reviewrouter.org/demo.md");
    expect(llms).toContain("not a general agent action API");
    expect(llms).toContain("https://reviewrouter.org/getting-started");
    expect(llms).toContain("https://reviewrouter.org/pricing");
    expect(llms).toContain("https://reviewrouter.org/agents.md");
    expect(llms).toContain("https://reviewrouter.org/auth.md");
    for (const line of llms.split("\n").filter((value) => value.startsWith("- "))) {
      expect(line.startsWith("- [")).toBe(true);
      expect(line).toContain("](https://");
      expect(line.endsWith(")")).toBe(true);
    }
  });

  it("keeps permission and proposed-billing boundaries explicit", () => {
    const auth = publicFile("auth.md");
    const guide = publicFile("agents.md");
    expect(auth).toContain("no public general-purpose agent OAuth");
    expect(auth).toContain("GitHub");
    expect(auth).toContain("GitLab");
    expect(guide).toContain("not available for purchase");
    expect(guide).toContain("GitHub Actions");
    expect(guide).toContain("setup PR");
    expect(guide).not.toContain("curl | bash");
  });
});
