// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HostedPoolDeviceLogin } from "./hosted-pool-device-login";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe("HostedPoolDeviceLogin", () => {
  it("shows the verification code without credential material", async () => {
    const startAction = vi.fn(async () => ({
      ok: true as const,
      loginId: "login-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: "2026-09-14T12:15:00.000Z",
      intervalSeconds: 3,
    }));
    const pollAction = vi.fn(async () => ({
      ok: true as const,
      status: "pending" as const,
      loginId: "login-1",
      userCode: "ABCD-EFGH",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: "2026-09-14T12:15:00.000Z",
    }));
    const view = render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        startAction={startAction}
        pollAction={pollAction}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Primary"), {
      target: { value: "Primary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    await waitFor(() => expect(pollAction).toHaveBeenCalled());
    expect(document.body.textContent).not.toMatch(
      /refresh|device-auth|id_token|access_token/iu,
    );
    view.unmount();
    await Promise.resolve();
  });
});
