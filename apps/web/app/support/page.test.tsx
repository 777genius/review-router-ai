// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  reviewRouterContactMailto,
  reviewRouterGitHubBugIssueUrl,
  reviewRouterGitHubSetupIssueUrl,
} from "../public-urls";
import SupportPage from "./page";

afterEach(() => {
  cleanup();
});

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function appRouteExists(path: string): boolean {
  return ["page.tsx", "route.ts"].some((file) =>
    existsSync(join(appDir, path, file)),
  );
}

describe("SupportPage", () => {
  it("links only to existing pages and the published support channels", () => {
    const { container } = render(<SupportPage />);
    const hrefs = [...container.querySelectorAll("a")].map(
      (link) => link.getAttribute("href") ?? "",
    );
    const issueTemplates = new Set<string>([
      reviewRouterGitHubBugIssueUrl,
      reviewRouterGitHubSetupIssueUrl,
    ]);

    expect(hrefs).toContain(reviewRouterContactMailto);
    for (const href of hrefs) {
      if (href.startsWith("/")) {
        expect(appRouteExists(href), href).toBe(true);
      } else if (href.startsWith("mailto:")) {
        expect(href.split("?")[0], href).toBe(reviewRouterContactMailto);
      } else {
        expect(issueTemplates.has(href), href).toBe(true);
      }
    }
  });
});
