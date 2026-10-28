// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { AccountsAddDialog } from "./accounts-add-dialog";
import { AccountsWorkspaceTabs } from "./accounts-workspace-tabs";
import { AccountActionsMenu, AccountMenuItem } from "./account-actions-menu";

afterEach(cleanup);

test("workspace shortcut opens My connections without starting a connection", async () => {
  render(
    <AccountsWorkspaceTabs
      available={<p>Workspace connections</p>}
      own={<p>Personal connections</p>}
    />,
  );
  expect(
    screen.getByRole("tab", { name: "Available in this workspace" }),
  ).toHaveProperty("ariaSelected", "true");
  fireEvent.click(
    screen.getByRole("button", { name: "Add from My connections" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("tab", { name: "My connections" })).toHaveProperty(
      "ariaSelected",
      "true",
    ),
  );
  expect(screen.getByText("Personal connections")).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
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
      own={<p>Existing connections</p>}
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
      own={null}
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
