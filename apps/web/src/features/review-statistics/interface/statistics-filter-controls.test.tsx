// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatisticsSeverity } from "@reviewrouter/features-review-statistics";
import { StatisticsFilterRecovery } from "./statistics-filter-controls";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
// The recovery race concerns pending navigation, independently of popup geometry.
vi.mock("@reviewrouter/ui", () => ({
  Button: () => null,
  SelectField: ({
    label,
    value,
    options,
    onValueChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onValueChange: (value: string) => void;
  }) => (
    <label>
      {label}
      <select
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
beforeEach(() => {
  router.replace.mockClear();
  window.history.replaceState(
    null,
    "",
    "/dashboard?section=statistics&workspace=team&keep=a#scope",
  );
});
afterEach(cleanup);
const choose = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("Statistics initial-read filter recovery", () => {
  it("combines consecutive changes before new server props arrive", () => {
    render(<StatisticsFilterRecovery filter={{ days: 30, severity: "all" }} />);
    choose("Period", "7");
    choose("Severity", "major");
    expect(router.replace).toHaveBeenNthCalledWith(
      1,
      "/dashboard?section=statistics&workspace=team&keep=a&statisticsDays=7#scope",
    );
    expect(router.replace).toHaveBeenNthCalledWith(
      2,
      "/dashboard?section=statistics&workspace=team&keep=a&statisticsDays=7&statisticsSeverity=major#scope",
    );
    expect(screen.getByLabelText("Period")).toHaveProperty("value", "7");
    expect(screen.getByLabelText("Severity")).toHaveProperty("value", "major");
  });
  it("rebases the next change from accepted SSR filters and browser navigation", () => {
    const view = render(
      <StatisticsFilterRecovery filter={{ days: 30, severity: "all" }} />,
    );
    choose("Period", "7");
    view.rerender(
      <StatisticsFilterRecovery
        filter={{ days: 90, severity: StatisticsSeverity.Minor }}
      />,
    );
    expect(screen.getByLabelText("Period")).toHaveProperty("value", "90");
    expect(screen.getByLabelText("Severity")).toHaveProperty("value", "minor");
    choose("Period", "30");
    expect(router.replace).toHaveBeenLastCalledWith(
      "/dashboard?section=statistics&workspace=team&keep=a&statisticsSeverity=minor#scope",
    );
    window.history.replaceState(
      null,
      "",
      "/dashboard?section=statistics&workspace=team&keep=a&statisticsDays=7#scope",
    );
    fireEvent.popState(window);
    expect(screen.getByLabelText("Period")).toHaveProperty("value", "7");
    expect(screen.getByLabelText("Severity")).toHaveProperty("value", "all");
    choose("Severity", "critical");
    expect(router.replace).toHaveBeenLastCalledWith(
      "/dashboard?section=statistics&workspace=team&keep=a&statisticsDays=7&statisticsSeverity=critical#scope",
    );
  });
});
