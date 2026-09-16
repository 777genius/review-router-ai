// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardCollapsibleShell } from "./dashboard-collapsible-shell";

afterEach(() => {
  cleanup();
});

describe("DashboardCollapsibleShell", () => {
  it("keeps the dashboard sidebar visible without a hide control", () => {
    render(
      <DashboardCollapsibleShell nav={<nav>Current workspace</nav>}>
        <main>Memory content</main>
      </DashboardCollapsibleShell>,
    );

    expect(screen.getByText("Memory content")).toBeTruthy();
    expect(screen.getByText("Current workspace")).toBeTruthy();
    expect(document.getElementById("dashboard-section-sidebar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hide sidebar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show sidebar" })).toBeNull();
  });
});
