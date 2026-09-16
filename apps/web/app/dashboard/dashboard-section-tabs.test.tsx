// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  dashboardSectionHref,
  dashboardSectionMeta,
} from "./dashboard-section";
import { DashboardSectionTabs } from "./dashboard-section-tabs";

afterEach(() => {
  cleanup();
});

describe("DashboardSectionTabs", () => {
  it("links Setup to its own page and renders icons for every nav item", () => {
    const items = (
      ["repositories", "memory", "setup", "policy", "diagnostics"] as const
    ).map((section) => ({
      section,
      label: dashboardSectionMeta[section].title,
      description: dashboardSectionMeta[section].navDescription,
      href: dashboardSectionHref(section, "acme"),
    }));

    render(<DashboardSectionTabs items={items} selectedSection="setup" />);

    const setupLink = screen.getByRole("tab", { name: /AccountsEncrypted/i });
    expect(setupLink.getAttribute("href")).toBe(
      "/dashboard/setup?workspace=acme#dashboard-section-content",
    );
    expect(setupLink.getAttribute("aria-current")).toBe("page");
    expect(setupLink.className).toContain("border-cyan-200");

    for (const section of items) {
      expect(
        document.querySelector(`[data-section-icon="${section.section}"]`),
      ).toBeTruthy();
      expect(screen.getByText(section.label)).toBeTruthy();
    }
  });
});
