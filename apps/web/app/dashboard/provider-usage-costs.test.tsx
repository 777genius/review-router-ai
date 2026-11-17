// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { UsageCosts } from "./provider-usage-tables";

afterEach(cleanup);
it("discloses an incomplete known subtotal without replacing it or mixing currencies", () => {
  const costs = [
    { amount: "0.001", currency: "USD", basis: "source_reported" },
    { amount: "0.4", currency: "EUR", basis: "estimated" },
  ];
  const view = render(
    <UsageCosts costs={costs} selectedCurrency="USD" unknownCostCount={1} />,
  );
  expect(screen.getByText("0.001 USD")).toBeTruthy();
  expect(screen.getByText("Excludes 1 call without cost")).toBeTruthy();
  expect(screen.queryByText("0.4 EUR")).toBeNull();
  view.rerender(
    <UsageCosts costs={costs} selectedCurrency="USD" unknownCostCount={0} />,
  );
  expect(screen.queryByText(/without cost/)).toBeNull();
});
it("keeps unreported cost unknown unless the requested model is provably free", () => {
  const view = render(<UsageCosts costs={[]} unknownCostCount={5} />);
  expect(screen.getByText("Not reported")).toBeTruthy();
  expect(screen.queryByText(/0 USD|Free model/)).toBeNull();
  view.rerender(<UsageCosts costs={[]} unknownCostCount={5} freeModel />);
  expect(screen.getByText("Free model")).toBeTruthy();
  expect(screen.queryByText(/without cost/)).toBeNull();
});
