// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { AccountsAddDialog } from "./accounts-add-dialog";
import { AccountActionsMenu, AccountMenuItem } from "./account-actions-menu";
import { CredentialImportFields } from "./credential-import-fields";

afterEach(cleanup);

test("clears credential import errors when a retained dialog is closed and reopened", async () => {
  render(
    <AccountsAddDialog
      workspaceName="Test workspace"
      organizationConnect={null}
      personalConnect={
        <CredentialImportFields method="oauth_auth_json" loading={vi.fn()} />
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    within(dialog).getByLabelText("Or choose an auth.json file"),
    {
      target: { files: [new File(["x".repeat(65537)], "auth.json")] },
    },
  );
  expect(within(dialog).getByRole("alert").textContent).toContain("64 KiB");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const reopened = await screen.findByRole("dialog");
  expect(within(reopened).queryByRole("alert")).toBeNull();
  expect(
    within(reopened)
      .getByLabelText("Or choose an auth.json file")
      .hasAttribute("aria-invalid"),
  ).toBe(false);
  expect(
    (within(reopened).getByLabelText("Codex auth.json") as HTMLTextAreaElement)
      .value,
  ).toBe("");
});

function Connect() {
  return (
    <AccountActionsMenu
      label="Connect account"
      triggerContent="Connect account"
    >
      <Dialog.Root>
        <AccountMenuItem>
          <Dialog.Trigger render={<Button />}>
            Connect with API key
          </Dialog.Trigger>
        </AccountMenuItem>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup>
            <Dialog.Title>Connect with API key</Dialog.Title>
            <SelectField
              name="profile"
              label="Provider profile"
              defaultValue="mimo"
              options={[
                { value: "mimo", label: "MiMo" },
                { value: "openrouter", label: "OpenRouter" },
              ]}
            />
            <Dialog.Close render={<Button />}>Cancel</Dialog.Close>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </AccountActionsMenu>
  );
}

test("uses one Add dialog and preserves provider fields when closed and reopened", async () => {
  const direct = (
    <SelectField
      name="profile"
      label="Provider"
      defaultValue="codex"
      options={[
        { value: "codex", label: "Codex" },
        { value: "mimo", label: "MiMo" },
      ]}
    />
  );
  render(
    <AccountsAddDialog
      workspaceName="Test workspace"
      personalConnect={direct}
      organizationConnect={<p>Organization connection</p>}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const dialog = await screen.findByRole("dialog", { name: "Add account" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  const provider = within(dialog).getByRole("combobox", { name: "Provider" });
  fireEvent.click(provider);
  const option = await screen.findByRole("option", { name: "MiMo" });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
  await waitFor(() => expect(provider.textContent).toContain("MiMo"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  expect(
    within(await screen.findByRole("dialog")).getByRole("combobox", {
      name: "Provider",
    }).textContent,
  ).toContain("MiMo");
});

test("keeps standalone account actions portaled outside their trigger container", async () => {
  const view = render(<Connect />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Connect account" }), {
    key: "ArrowDown",
  });
  expect(view.container.contains(await screen.findByRole("menu"))).toBe(false);
});

test("clears unsubmitted credentials when hiding the retained connection form", async () => {
  render(
    <AccountsAddDialog
      workspaceName="Test workspace"
      organizationConnect={null}
      personalConnect={
        <>
          <label>
            API key
            <input type="password" />
          </label>
          <label>
            Callback
            <input name="callbackURL" />
          </label>
        </>
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const dialog = await screen.findByRole("dialog");
  const key = within(dialog).getByLabelText("API key") as HTMLInputElement;
  const callback = within(dialog).getByLabelText(
    "Callback",
  ) as HTMLInputElement;
  fireEvent.change(key, { target: { value: "unsubmitted-key" } });
  fireEvent.change(callback, { target: { value: "unsubmitted-callback" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(key.value).toBe("");
  expect(callback.value).toBe("");
});

test("reusing a connection closes Add over the list without granting workspace access", async () => {
  const grant = vi.fn();
  render(
    <>
      <AccountsAddDialog
        workspaceName="Test workspace"
        personalConnect={<p>New personal connection</p>}
        organizationConnect={<p>New organization connection</p>}
      />
      <button onClick={grant}>Grant workspace access</button>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  const dialog = await screen.findByRole("dialog", { name: "Add account" });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Use an existing connection" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("tab")).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Grant workspace access" }),
  ).toHaveLength(1);
  expect(grant).not.toHaveBeenCalled();
});
