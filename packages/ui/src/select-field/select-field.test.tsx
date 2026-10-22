// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SelectField } from "./select-field";
afterEach(cleanup);
describe("SelectField", () => {
  it("updates displayed selection when a controlled parent resets its value", () => {
    const options = [
      { value: "a", label: "Provider A" },
      { value: "b", label: "Provider B" },
    ];
    const view = render(
      <SelectField
        name="provider"
        label="Provider"
        value="a"
        options={options}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Provider A");
    view.rerender(
      <SelectField
        name="provider"
        label="Provider"
        value="b"
        options={options}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Provider B");
  });
  it("preserves defaultValue support for existing forms", () => {
    render(
      <SelectField
        name="provider"
        label="Provider"
        defaultValue="a"
        options={[{ value: "a", label: "Provider A" }]}
      />,
    );
    expect(screen.getByRole("combobox").textContent).toContain("Provider A");
  });
});
