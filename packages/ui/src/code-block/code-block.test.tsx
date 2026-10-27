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
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("CodeBlock", () => {
  it.each(["copied", "failed"] as const)(
    "clears previous %s feedback while a retry is pending",
    async (previousOutcome) => {
      vi.useFakeTimers();
      let finishRetry!: () => void;
      const writeText = vi.fn();
      if (previousOutcome === "copied")
        writeText.mockResolvedValueOnce(undefined);
      else writeText.mockRejectedValueOnce(new Error("clipboard denied"));
      writeText.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRetry = resolve;
          }),
      );
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      render(<CodeBlock code="gh secret set TOKEN --repo acme/widget" />);
      const copy = screen.getByRole("button", { name: "Copy code" });
      await act(async () => {
        fireEvent.click(copy);
      });
      if (previousOutcome === "copied") expect(copy.textContent).toBe("Copied");
      else expect(screen.getByRole("status")).toBeTruthy();

      fireEvent.click(copy);
      expect(copy.textContent).toBe("Copy");
      expect(screen.queryByRole("status")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(copy.textContent).toBe("Copy");

      await act(async () => {
        finishRetry();
      });
      expect(copy.textContent).toBe("Copied");
      act(() => {
        vi.advanceTimersByTime(1399);
      });
      expect(copy.textContent).toBe("Copied");
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(copy.textContent).toBe("Copy");
    },
  );

  it.each(["copied", "failed"] as const)(
    "preserves the latest %s feedback when an older copy of the same command finishes",
    async (latestOutcome) => {
      vi.useFakeTimers();
      let resolveOld!: () => void;
      let rejectOld!: (reason: Error) => void;
      const oldCopy = new Promise<void>((resolve, reject) => {
        resolveOld = resolve;
        rejectOld = reject;
      });
      let resolveLatest!: () => void;
      let rejectLatest!: (reason: Error) => void;
      const latestCopy = new Promise<void>((resolve, reject) => {
        resolveLatest = resolve;
        rejectLatest = reject;
      });
      const writeText = vi
        .fn()
        .mockReturnValueOnce(oldCopy)
        .mockReturnValueOnce(latestCopy);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const code = "gh secret set TOKEN --repo acme/widget";
      render(<CodeBlock code={code} />);
      const copy = screen.getByRole("button", { name: "Copy code" });

      fireEvent.click(copy);
      fireEvent.click(copy);
      expect(writeText).toHaveBeenCalledTimes(2);
      expect(writeText).toHaveBeenNthCalledWith(1, code);
      expect(writeText).toHaveBeenNthCalledWith(2, code);

      function expectLatestFeedback(): void {
        expect(copy.textContent).toBe(
          latestOutcome === "copied" ? "Copied" : "Copy",
        );
        if (latestOutcome === "copied")
          expect(screen.queryByRole("status")).toBeNull();
        else
          expect(screen.getByRole("status").textContent).toBe(
            "Could not copy. Select the code and copy it manually.",
          );
      }

      await act(async () => {
        if (latestOutcome === "copied") resolveLatest();
        else rejectLatest(new Error("latest clipboard access denied"));
      });
      expectLatestFeedback();

      await act(async () => {
        if (latestOutcome === "copied")
          rejectOld(new Error("earlier clipboard access denied"));
        else resolveOld();
      });
      expectLatestFeedback();
    },
  );

  it("keeps the second successful copy feedback for its full 1400ms", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code="gh secret set TOKEN --repo acme/widget" />);
    const copy = screen.getByRole("button", { name: "Copy code" });

    await act(async () => {
      fireEvent.click(copy);
    });
    expect(copy.textContent).toBe("Copied");
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    await act(async () => {
      fireEvent.click(copy);
    });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(copy.textContent).toBe("Copied");

    // The first copy's deadline must not clear the second copy's feedback.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(copy.textContent).toBe("Copied");
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(copy.textContent).toBe("Copied");
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(copy.textContent).toBe("Copy");
    expect(screen.queryByRole("status")).toBeNull();
  });

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
