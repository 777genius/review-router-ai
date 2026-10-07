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

function futureExpiry(minutes = 15): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function expectNoCredentialLeak(): void {
  expect(document.body.textContent).not.toMatch(
    /token|fingerprint|credentialRef|refresh|device-auth|id_token|access_token/iu,
  );
}

function pendingStart(expiresAt = futureExpiry()) {
  return vi.fn(async () => ({
    ok: true as const,
    loginId: "login-1",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresAt,
    intervalSeconds: 3,
  }));
}

function pendingPoll(expiresAt = futureExpiry()) {
  return vi.fn(async () => ({
    ok: true as const,
    status: "pending" as const,
    loginId: "login-1",
    userCode: "ABCD-EFGH",
    verificationUrl: "https://auth.openai.com/codex/device",
    expiresAt,
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
    expect(screen.getByPlaceholderText("Work laptop")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeTruthy();
    expect(screen.queryByText("Priority")).toBeNull();
    expect(document.querySelector('input[name="priority"]')).toHaveProperty(
      "type",
      "hidden",
    );
    expect(screen.queryByText("Add another ChatGPT account")).toBeNull();
    expectNoCredentialLeak();
  });

  it("shows the verification code without credential material", async () => {
    const expiresAt = futureExpiry();
    const startAction = pendingStart(expiresAt);
    const pollAction = pendingPoll(expiresAt);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const view = render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        startAction={startAction}
        pollAction={pollAction}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Work laptop"), {
      target: { value: "Primary" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open ChatGPT" })).toHaveProperty(
      "href",
      "https://auth.openai.com/codex/device",
    );
    expect(screen.getByText(/detect the login automatically/i)).toBeTruthy();
    expect(screen.queryByText(/Connect ChatGPT to get started/)).toBeNull();
    expect(screen.getByText(/expires in \d+:\d{2}/i)).toBeTruthy();
    expect(screen.queryByText(/UTC/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ABCD-EFGH"));
    expect(
      screen.queryByRole("button", { name: "Start ChatGPT sign-in" }),
    ).toBeNull();
    await waitFor(() => expect(pollAction).toHaveBeenCalled());
    expectNoCredentialLeak();
    view.unmount();
    await Promise.resolve();
  });

  it("tells the operator when the code cannot be copied", async () => {
    const expiresAt = futureExpiry();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });
    render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        startAction={pendingStart(expiresAt)}
        pollAction={pendingPoll(expiresAt)}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Work laptop"), {
      target: { value: "Primary" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText(/Could not copy/i)).toBeTruthy();
    expectNoCredentialLeak();
  });

  it("opens the add form before the account list", async () => {
    const expiresAt = futureExpiry();
    const startAction = pendingStart(expiresAt);
    const pollAction = pendingPoll(expiresAt);
    render(
      <HostedPoolDeviceLogin
        workspaceId="workspace-1"
        mutationsEnabled
        enrolled
        header={<div>Accounts header</div>}
        startAction={startAction}
        pollAction={pollAction}
      >
        <div>Existing account list</div>
      </HostedPoolDeviceLogin>,
    );

    expect(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Work laptop")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add another ChatGPT account" }),
    );
    const signInHeading = screen.getByText("Sign in with ChatGPT");
    const accountList = screen.getByText("Existing account list");
    expect(
      signInHeading.compareDocumentPosition(accountList) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Work laptop"), {
      target: { value: "Primary" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Start ChatGPT sign-in" }),
    );
    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(screen.getByText(/detect the login automatically/i)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add another ChatGPT account" }),
    ).toBeNull();
    expectNoCredentialLeak();
  });
});
