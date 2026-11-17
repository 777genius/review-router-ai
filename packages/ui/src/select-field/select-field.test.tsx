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
  it("renders an empty-value option as a selected choice, not a muted placeholder", () => {
    const view = render(
      <SelectField
        label="Provider"
        value=""
        options={[
          { value: "", label: "All providers" },
          { value: "codex", label: "codex" },
        ]}
      />,
    );
    const value = screen.getByText("All providers");
    expect(value.className).not.toContain("text-slate-500");
    view.rerender(
      <SelectField
        label="Provider"
        value=""
        placeholder="Choose a provider"
        options={[{ value: "codex", label: "codex" }]}
      />,
    );
    expect(screen.getByText("Choose a provider").className).toContain(
      "data-[placeholder]:text-slate-500",
    );
  });
  it("shows the selected option's icon on a controlled control", () => {
    render(
      <SelectField
        label="Account"
        value="grok"
        options={[
          { value: "codex", label: "Team Codex", icon: <i>codex-logo</i> },
          { value: "grok", label: "Team Grok", icon: <i>grok-logo</i> },
        ]}
      />,
    );
    const control = screen.getByRole("combobox");
    expect(control.textContent).toContain("grok-logo");
    expect(control.textContent).not.toContain("codex-logo");
  });
});
