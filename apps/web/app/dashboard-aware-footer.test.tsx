// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DashboardAwareFooter } from "./dashboard-aware-footer";

const route = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
afterEach(cleanup);

it("uses the compact dashboard footer through navigation and preserves the public footer elsewhere", () => {
  const footer = () => (
    <DashboardAwareFooter>
      <footer>Public product and trust information</footer>
    </DashboardAwareFooter>
  );
  const view = render(footer());
  expect(
    screen.getByRole("contentinfo", { name: "Dashboard footer" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Support" }).getAttribute("href"),
  ).toBe("/support");
  expect(
    screen.getByRole("link", { name: "Privacy" }).getAttribute("href"),
  ).toBe("/privacy");
  expect(screen.queryByText("Public product and trust information")).toBeNull();

  route.pathname = "/dashboard/setup";
  view.rerender(footer());
  expect(
    screen.getByRole("contentinfo", { name: "Dashboard footer" }),
  ).toBeTruthy();

  route.pathname = "/support";
  view.rerender(footer());
  expect(screen.getByText("Public product and trust information")).toBeTruthy();
  expect(
    screen.queryByRole("contentinfo", { name: "Dashboard footer" }),
  ).toBeNull();
});
