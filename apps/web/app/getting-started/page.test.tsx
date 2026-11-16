// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import GettingStartedPage from "./page";

afterEach(() => {
  cleanup();
});

describe("GettingStartedPage", () => {
  it("directs users to the dashboard-generated verified command", () => {
    const { container } = render(<GettingStartedPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("Copy and run the complete command generated there");
    expect(text).toContain("verifies its SHA-256");
    expect(text).not.toContain("| bash");
    expect(text).not.toContain("curl -fsSL ");
    expect(text).not.toContain("/install/codex-reseed");
  });

  it("shows the repository-specific interactive MiMo secret command", () => {
    const { container } = render(<GettingStartedPage />);
    const text = container.textContent ?? "";

    expect(text).toContain(
      "gh secret set MIMO_TOKEN_PLAN_API_KEY --repo owner/repo --app actions",
    );
    expect(text).toContain("gh asks for the key at its own secret prompt");
  });
});

describe("GettingStartedPage content", () => {
  it("covers hosted and self-hosted setup and every supported provider secret", () => {
    const { container } = render(<GettingStartedPage />);
    const text = container.textContent ?? "";

    expect(text).toContain("reviewrouter/setup");
    expect(text).toContain("install-self-hosted.sh");
    for (const secret of [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "MIMO_TOKEN_PLAN_API_KEY",
      "OPENROUTER_API_KEY",
      "KIMI_CODE_API_KEY",
    ]) {
      expect(text).toContain(secret);
    }
  });
});
