// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostedPoolDeviceLogin } from "./hosted-pool-device-login";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

function expectNoCredentialLeak(): void {
  expect(document.body.textContent).not.toMatch(
    /token|fingerprint|credentialRef|refresh|device-auth|id_token|access_token/iu,
  );
}

function pendingStart() {
  return vi.fn(async () => ({
    ok: true as const,
    loginId: "login-1",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresAt: "2026-09-14T12:15:00.000Z",
    intervalSeconds: 3,
  }));
}

function pendingPoll() {
  return vi.fn(async () => ({
    ok: true as const,
    status: "pending" as const,
    loginId: "login-1",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresAt: "2026-09-14T12:15:00.000Z",
  }));
}

afterEach(() => {
  cleanup();
});

describe("HostedPoolDeviceLogin", () => {
  it("keeps the empty ChatGPT start form as the primary path", () => {
    render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        startAction={pendingStart()}
        pollAction={pendingPoll()}
      />,
    );

    expect(screen.getByText("Sign in with ChatGPT")).toBeTruthy();
    expect(screen.getByPlaceholderText("Primary")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeTruthy();
    expect(screen.queryByText("Add another ChatGPT account")).toBeNull();
    expectNoCredentialLeak();
  });

  it("shows the verification code without credential material", async () => {
    const startAction = pendingStart();
    const pollAction = pendingPoll();
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
    fireEvent.click(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByText(/Waiting for ChatGPT/)).toBeTruthy();
    expect(screen.getByText(/12:15 UTC/)).toBeTruthy();
    expect(screen.queryByText(/expires in 15 minutes/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeNull();
    await waitFor(() => expect(pollAction).toHaveBeenCalled());
    expectNoCredentialLeak();
    view.unmount();
    await Promise.resolve();
  });

  it("collapses the start form after accounts exist until waiting", async () => {
    const startAction = pendingStart();
    const pollAction = pendingPoll();
    render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        enrolled
        startAction={startAction}
        pollAction={pollAction}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    ).toBeTruthy();
    expect(screen.getByText(/never go to the browser/i)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Primary")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Primary"), {
      target: { value: "Primary" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByText(/Waiting for ChatGPT/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add another ChatGPT account" }),
    ).toBeNull();
    expectNoCredentialLeak();
  });
});
