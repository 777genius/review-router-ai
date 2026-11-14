// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeVisualPreview } from "./home-visual-preview";

afterEach(() => cleanup());

describe("HomeVisualPreview", () => {
  it("starts with a concise severity list, not raw code", () => {
    render(<HomeVisualPreview />);
    expect(screen.getByText("Missing input validation")).toBeTruthy();
    expect(screen.getByText("Duplicate request in a loop")).toBeTruthy();
    expect(screen.getByText("Error path needs handling")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Findings" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("Initial review")).toBeNull();
  });

  it("switches the meaningful product examples with real buttons", () => {
    render(<HomeVisualPreview />);
    fireEvent.click(screen.getByRole("button", { name: "Commits" }));
    expect(screen.getByText("Initial review")).toBeTruthy();
    expect(screen.getByText("Add regression tests")).toBeTruthy();
    expect(screen.queryByText("Missing input validation")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Commits" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Insights" }));
    expect(screen.getByText("Known costs")).toBeTruthy();
    expect(screen.getByText("Unknown costs are labelled")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Insights" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
