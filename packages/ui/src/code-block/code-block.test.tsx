// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./code-block";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CodeBlock", () => {
  it("copies the original code without changing its whitespace", async () => {
    const code = "  gh secret set EXAMPLE_TOKEN\n\n";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code={code} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("explains how to copy when the Clipboard API is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    render(<CodeBlock code="gh secret set EXAMPLE_TOKEN" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect((await screen.findByRole("status")).textContent).toBe(
      "Could not copy. Select the code and copy it manually.",
    );
    expect(screen.getByRole("button", { name: "Copy code" }).textContent).toBe(
      "Copy",
    );
  });

  it("reports denied clipboard access and clears the message after a successful retry", async () => {
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error("clipboard access denied"))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code="gh secret set EXAMPLE_TOKEN" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Could not copy. Select the code and copy it manually.",
    );
    expect(screen.getByRole("button", { name: "Copy code" }).textContent).toBe(
      "Copy",
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
