// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedPoolPreviewClient } from "./hosted-pool-preview-client";
import {
  buildHostedPoolPreviewView,
  hostedPoolPreviewScenarios,
} from "./hosted-pool-preview-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/dashboard/hosted-pool-preview",
}));

function expectNoCredentialLeak(): void {
  expect(document.body.textContent).not.toMatch(
    /token|fingerprint|credentialRef|id_token|access_token/iu,
  );
}

afterEach(() => {
  cleanup();
});

describe("hosted pool preview fixtures", () => {
  it("keeps every scenario free of credential material", () => {
    for (const scenario of hostedPoolPreviewScenarios()) {
      const serialized = JSON.stringify(buildHostedPoolPreviewView(scenario));
      expect(serialized).not.toMatch(
        /token|fingerprint|credentialRef|id_token|access_token/iu,
      );
    }
  });
});

describe("HostedPoolPreviewClient", () => {
  it("renders the empty ChatGPT connect path", () => {
    render(<HostedPoolPreviewClient scenario="empty" />);
    expect(
      screen.getByRole("navigation", { name: "Dashboard sections" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Repositories").length).toBeGreaterThan(0);
    expect(screen.getByText("Sign in with ChatGPT")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("renders the waiting code panel with auto-detect copy", () => {
    render(<HostedPoolPreviewClient scenario="waiting" />);
    expect(screen.getByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open ChatGPT" })).toBeTruthy();
    expect(screen.getByText(/detect the login automatically/i)).toBeTruthy();
    expect(screen.queryByText(/Connect ChatGPT to get started/)).toBeNull();
    expectNoCredentialLeak();
  });

  it("renders enrolled and paused account cards", () => {
    const enrolled = render(<HostedPoolPreviewClient scenario="enrolled" />);
    expect(screen.getByText("1st in line")).toBeTruthy();
    expect(screen.getByText("2nd in line")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Remove account" }).length,
    ).toBe(3);
    expect(screen.getByText("2 of 3 ready")).toBeTruthy();
    enrolled.unmount();

    render(<HostedPoolPreviewClient scenario="paused" />);
    expect(screen.getByText("None ready")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Use for reviews again" }).length,
    ).toBe(2);
    expectNoCredentialLeak();
  });
});
