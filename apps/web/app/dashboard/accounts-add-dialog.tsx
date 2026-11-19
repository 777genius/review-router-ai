"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { accountsCopy } from "./accounts-copy";

/**
 * Closes the Add dialog to reveal the Connections list right under it. Null
 * outside the dialog, where callers link to the list instead.
 */
const ShowConnectionsListContext = createContext<(() => void) | null>(null);
export const useShowConnectionsList = () =>
  useContext(ShowConnectionsListContext);

export function AccountsAddDialog({
  personalConnect,
  organizationConnect,
  workspaceName,
  initiallyOpen = false,
  initialOwnership = "personal",
}: {
  personalConnect: ReactNode;
  organizationConnect: ReactNode;
  workspaceName: string;
  initiallyOpen?: boolean;
  initialOwnership?: "personal" | "organization";
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [path, setPath] = useState(initialOwnership);
  const cancel = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  function clearUnsubmittedCredentials() {
    popup.current
      ?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >('input[type="password"], input[name="callbackURL"], input[name="authorizationCode"], textarea[name="credential"], input[name="credentialFile"]')
      .forEach((field) => {
        field.value = "";
      });
  }
  function showConnectionsList() {
    clearUnsubmittedCredentials();
    setOpen(false);
  }
  return (
    <ShowConnectionsListContext.Provider value={showConnectionsList}>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) clearUnsubmittedCredentials();
          setOpen(next);
        }}
      >
        <Dialog.Trigger render={<Button variant="outline" />}>
          {accountsCopy.add}
        </Dialog.Trigger>
        <Dialog.Portal keepMounted>
          <Dialog.Backdrop />
          <Dialog.Popup
            ref={popup}
            initialFocus={cancel}
            className="w-[min(92vw,36rem)]"
          >
            <Dialog.Title>{accountsCopy.add}</Dialog.Title>
            <Dialog.Description>
              Choose your provider and connect securely.
            </Dialog.Description>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={showConnectionsList}
            >
              Use an existing connection
            </Button>
            <div className="my-4 max-w-sm">
              <SelectField
                name="connectionOwnership"
                label="Owner"
                value={path}
                onValueChange={(next) => {
                  clearUnsubmittedCredentials();
                  if (next === "personal" || next === "organization")
                    setPath(next);
                }}
                options={[
                  {
                    value: "personal",
                    label: "You · personal account",
                  },
                  {
                    value: "organization",
                    label: `${workspaceName} · organization account`,
                  },
                ]}
              />
            </div>
            <div hidden={path !== "organization"}>
              <p className="mb-4 text-sm text-slate-400">
                Owned by {workspaceName}. Workspace admins manage this
                connection.
              </p>
              {organizationConnect}
            </div>
            <div hidden={path !== "personal"}>
              <p className="mb-4 text-sm text-slate-400">
                You own this connection. It is added to {workspaceName} as soon
                as it connects.
              </p>
              {personalConnect}
            </div>
            <Dialog.Footer>
              <Dialog.Close render={<Button ref={cancel} variant="outline" />}>
                Close
              </Dialog.Close>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </ShowConnectionsListContext.Provider>
  );
}
