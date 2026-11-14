// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeFindingsPreview } from "./home-findings-preview";

afterEach(cleanup);

describe("HomeFindingsPreview", () => {
  it("offers distinct interactive severities without code or long AI comments", () => {
    render(<HomeFindingsPreview />);
    const critical = screen.getByRole("button", { name: "Preview Critical finding" });
    const major = screen.getByRole("button", { name: "Preview Major finding" });
    const minor = screen.getByRole("button", { name: "Preview Minor finding" });
    expect(critical.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(major);
    expect(critical.getAttribute("aria-pressed")).toBe("false");
    expect(major.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Major selected");
    fireEvent.click(minor);
    expect(minor.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Illustrative PR review")).toBeTruthy();
    expect(document.querySelector("pre")).toBeNull();
  });
});
