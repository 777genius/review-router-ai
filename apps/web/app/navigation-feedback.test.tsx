// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNavigationFeedback,
  NavigationFeedbackProvider,
} from "./navigation-feedback";

const route = vi.hoisted(() => ({
  pathname: "/dashboard",
  search: "workspace=one&section=repositories",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(route.search),
}));

function PendingTargetProbe(): React.ReactElement {
  const { isPending, target } = useNavigationFeedback();
  return (
    <output data-testid="pending-target">
      {isPending && target ? `${target.pathname}${target.search}` : "idle"}
    </output>
  );
}

beforeEach(() => {
  route.pathname = "/dashboard";
  route.search = "workspace=one&section=repositories";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("NavigationFeedbackProvider", () => {
  it("starts a global progress bar for an internal route and completes it after the route changes", () => {
    vi.useFakeTimers();
    const preventNavigation = (event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault();
    const view = render(
      <NavigationFeedbackProvider>
        <a href="/security" onClick={preventNavigation}>
          Security
        </a>
        <PendingTargetProbe />
      </NavigationFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Security" }));
    expect(screen.getByRole("progressbar").getAttribute("data-state")).toBe(
      "loading",
    );
    expect(screen.getByTestId("pending-target").textContent).toBe("/security");

    route.pathname = "/security";
    route.search = "";
    view.rerender(
      <NavigationFeedbackProvider>
        <a href="/security" onClick={preventNavigation}>
          Security
        </a>
        <PendingTargetProbe />
      </NavigationFeedbackProvider>,
    );
    expect(screen.getByRole("progressbar").getAttribute("data-state")).toBe(
      "complete",
    );

    act(() => vi.advanceTimersByTime(220));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByTestId("pending-target").textContent).toBe("idle");
  });

  it("ignores external, hash-only, new-tab and explicitly ignored links", () => {
    const preventNavigation = (event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault();
    render(
      <NavigationFeedbackProvider>
        <a href="https://example.com" onClick={preventNavigation}>
          External
        </a>
        <a href="#details" onClick={preventNavigation}>
          Details
        </a>
        <a href="/security" target="_blank" onClick={preventNavigation}>
          New tab
        </a>
        <a
          href="/security"
          data-navigation-feedback="ignore"
          onClick={preventNavigation}
        >
          Ignore
        </a>
      </NavigationFeedbackProvider>,
    );

    for (const name of ["External", "Details", "New tab", "Ignore"])
      fireEvent.click(screen.getByRole("link", { name }));

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("cancels pending feedback when navigation returns to the current route", () => {
    const preventNavigation = (event: React.MouseEvent<HTMLAnchorElement>) =>
      event.preventDefault();
    render(
      <NavigationFeedbackProvider>
        <a href="/security" onClick={preventNavigation}>
          Security
        </a>
        <a
          href="/dashboard?workspace=one&section=repositories"
          onClick={preventNavigation}
        >
          Current dashboard
        </a>
      </NavigationFeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Security" }));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Current dashboard" }));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
