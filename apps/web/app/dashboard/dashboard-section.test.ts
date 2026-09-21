import { describe, expect, it } from "vitest";
import {
  dashboardClientNavigationHref,
  dashboardPath,
  dashboardSectionHref,
  resolveDashboardSection,
} from "./dashboard-section";

describe("dashboard section routing", () => {
  it("sends Setup to its own page while keeping the workspace query", () => {
    expect(dashboardSectionHref("setup", "acme")).toBe(
      "/dashboard/setup?workspace=acme#dashboard-section-content",
    );
    expect(dashboardPath({ section: "setup", workspace: "acme" })).toBe(
      "/dashboard/setup?workspace=acme",
    );
  });

  it("keeps other sections on the main dashboard query", () => {
    expect(dashboardSectionHref("repositories", "acme")).toBe(
      "/dashboard?section=repositories&workspace=acme#dashboard-section-content",
    );
    expect(
      dashboardPath({
        section: "policy",
        workspace: "acme",
        notice: "review_config_saved",
      }),
    ).toBe(
      "/dashboard?section=policy&workspace=acme&notice=review_config_saved",
    );
  });

  it("removes the content fragment from persistent client navigation", () => {
    expect(
      dashboardClientNavigationHref(dashboardSectionHref("policy", "acme")),
    ).toBe("/dashboard?section=policy&workspace=acme");
    expect(dashboardClientNavigationHref("/dashboard?section=memory")).toBe(
      "/dashboard?section=memory",
    );
  });

  it("redirects legacy section=setup links without dropping notices", () => {
    expect(
      dashboardPath({
        section: "setup",
        workspace: "acme",
        notice: "org_ruleset_queued",
      }),
    ).toBe("/dashboard/setup?workspace=acme&notice=org_ruleset_queued");
  });

  it("resolves org-ruleset notices to Repositories", () => {
    expect(resolveDashboardSection({ notice: "org_ruleset_queued" })).toBe(
      "repositories",
    );
  });
});
