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
  expect(screen.getByText("Some cost unknown")).toBeTruthy();
  expect(screen.queryByText("0.4 EUR")).toBeNull();
  view.rerender(
    <UsageCosts costs={costs} selectedCurrency="USD" unknownCostCount={0} />,
  );
  expect(screen.queryByText("Some cost unknown")).toBeNull();
});
