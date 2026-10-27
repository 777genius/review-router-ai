// @vitest-environment jsdom
import {
  act,
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
  it.each(["copied", "failed"] as const)(
    "clears %s feedback when a different command is shown",
    async (outcome) => {
      const writeText = vi.fn();
      if (outcome === "copied") writeText.mockResolvedValue(undefined);
      else writeText.mockRejectedValue(new Error("clipboard access denied"));
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const view = render(
        <CodeBlock code="gh secret set TOKEN --repo acme/old" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      if (outcome === "copied") await screen.findByText("Copied");
      else await screen.findByRole("status");

      view.rerender(<CodeBlock code="gh secret set TOKEN --org acme" />);

      expect(
        screen.getByRole("button", { name: "Copy code" }).textContent,
      ).toBe("Copy");
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it.each(["copied", "failed"] as const)(
    "ignores delayed %s feedback for a command that is no longer shown",
    async (outcome) => {
      let finish: () => void = () => {};
      const writeText = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve, reject) => {
              finish =
                outcome === "copied"
                  ? resolve
                  : () => reject(new Error("clipboard access denied"));
            }),
        )
        .mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const view = render(
        <CodeBlock code="gh secret set TOKEN --repo acme/old" />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      view.rerender(<CodeBlock code="gh secret set TOKEN --org acme" />);

      await act(async () => {
        finish();
      });

      expect(
        screen.getByRole("button", { name: "Copy code" }).textContent,
      ).toBe("Copy");
      expect(screen.queryByRole("status")).toBeNull();
      expect(writeText).toHaveBeenCalledWith(
        "gh secret set TOKEN --repo acme/old",
      );
      fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
      await screen.findByText("Copied");
      expect(writeText).toHaveBeenLastCalledWith(
        "gh secret set TOKEN --org acme",
      );
    },
  );

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
