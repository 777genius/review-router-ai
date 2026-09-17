// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@reviewrouter/ui", () => ({
  Badge: ({ children }: { readonly children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));

import { GitLabBetaConnectButton } from "./gitlab-beta-connect-button";

afterEach(() => {
  cleanup();
});

describe("GitLabBetaConnectButton", () => {
  it("renders a disabled GitLab CTA with a Beta badge and no setup link", () => {
    render(<GitLabBetaConnectButton />);

    const button = screen.getByRole("button", {
      name: "Connect GitLab (Beta, unavailable)",
    });

    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("title")).toBe(
      "GitLab setup is in beta and not available yet.",
    );
    expect(screen.getByText("Beta")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(document.body.innerHTML).not.toContain("/setup/gitlab");
  });
});
