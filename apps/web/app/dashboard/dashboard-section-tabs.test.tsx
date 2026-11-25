// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DASHBOARD_NAV_SECTIONS,
  dashboardSectionHref,
  dashboardSectionMeta,
} from "./dashboard-section";
import {
  DashboardSectionCompactNav,
  DashboardSectionTabs,
  ProvidersHubNav,
} from "./dashboard-section-tabs";

afterEach(() => {
  cleanup();
});

describe("DashboardSectionTabs", () => {
  it("offers one Providers area and Review settings with icons for every nav item", () => {
    const items = DASHBOARD_NAV_SECTIONS.map((section) => ({
      section,
      label: dashboardSectionMeta[section].title,
      description: dashboardSectionMeta[section].navDescription,
      href: dashboardSectionHref(section, "acme"),
    }));

    render(<DashboardSectionTabs items={items} selectedSection="providers" />);

    expect(DASHBOARD_NAV_SECTIONS.at(-1)).toBe("memory");
    expect(dashboardSectionMeta.memory.navDescription).toMatch(
      /approved review knowledge/i,
    );
    expect(dashboardSectionMeta.memory.description).toMatch(/approved rules/i);
    expect(
      screen.getByRole("tab", {
        name: /^Memory\s*Approved review knowledge$/i,
      }),
    ).toBeTruthy();
    const providersLink = screen.getByRole("tab", {
      name: /ProvidersConnections and models/i,
    });
    expect(providersLink.getAttribute("href")).toBe(
      "/dashboard?section=providers&workspace=acme",
    );
    expect(providersLink.getAttribute("aria-current")).toBe("page");
    expect(providersLink.className).toContain("border-cyan-200");
    expect(screen.queryByRole("tab", { name: /Accounts/i })).toBeNull();
    expect(
      screen.getByRole("tab", {
        name: /^Review settingsReview behavior and gates$/i,
      }),
    ).toBeTruthy();

    for (const section of items) {
      expect(
        document.querySelector(`[data-section-icon="${section.section}"]`),
      ).toBeTruthy();
      expect(screen.getByText(section.label)).toBeTruthy();
    }
  });

  it("renders the same section icons in the compact nav", () => {
    const items = DASHBOARD_NAV_SECTIONS.map((section) => ({
      section,
      label: dashboardSectionMeta[section].title,
      description: dashboardSectionMeta[section].navDescription,
      href: dashboardSectionHref(section, "acme"),
    }));

    render(
      <DashboardSectionCompactNav items={items} selectedSection="providers" />,
    );

    for (const section of items) {
      expect(
        document.querySelector(`[data-section-icon="${section.section}"]`),
      ).toBeTruthy();
    }
    expect(
      screen.getByRole("link", { name: /^Providers$/i }).querySelector("svg"),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: /^Memory$/i })).toBeTruthy();
  });

  it.each(["providers", "setup"] as const)(
    "links both Providers views using their existing routes (%s active)",
    (selectedSection) => {
      render(
        <ProvidersHubNav
          selectedSection={selectedSection}
          providersHref={dashboardSectionHref("providers", "second-workspace")}
          connectionsHref={dashboardSectionHref("setup", "second-workspace")}
        />,
      );
      expect(
        screen.getByRole("navigation", { name: "Providers" }),
      ).toBeTruthy();
      const providers = screen.getByRole("link", { name: "Review providers" });
      const connections = screen.getByRole("link", { name: "Connections" });
      expect(providers.getAttribute("href")).toBe(
        "/dashboard?section=providers&workspace=second-workspace",
      );
      expect(connections.getAttribute("href")).toBe(
        "/dashboard/setup?workspace=second-workspace",
      );
      expect(providers.getAttribute("aria-current")).toBe(
        selectedSection === "providers" ? "page" : null,
      );
      expect(connections.getAttribute("aria-current")).toBe(
        selectedSection === "setup" ? "page" : null,
      );
    },
  );
});
