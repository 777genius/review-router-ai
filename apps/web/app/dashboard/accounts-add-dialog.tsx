"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import { accountsCopy } from "./accounts-copy";

export function AccountsAddDialog({
  own,
  personalConnect,
  organizationConnect,
  workspaceName,
}: {
  own: ReactNode;
  personalConnect: ReactNode;
  organizationConnect: ReactNode;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("personal");
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setPath("personal");
      }}
    >
      <Dialog.Trigger render={<Button variant="outline" />}>
        {accountsCopy.add}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup initialFocus={cancel} className="w-[min(92vw,44rem)]">
          <Dialog.Title>{accountsCopy.add}</Dialog.Title>
          <Dialog.Description>
            Choose a connection and its owner. Organization access does not
            transfer ownership and does not change your selection in Models.
          </Dialog.Description>
          <div className="my-4">
            <SelectField
              name="connectionOwnership"
              label="How to add"
              defaultValue="personal"
              onValueChange={setPath}
              options={[
                {
                  value: "personal",
                  label: "Connect new · personal, owned by you",
                },
                { value: "existing", label: "Use my connection" },
                {
                  value: "organization",
                  label: `Connect new · owned by ${workspaceName}`,
                },
              ]}
            />
          </div>
          {path === "existing" ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                Click “Access” in the connection row and add {workspaceName}.
                Access already granted is shown separately.
              </p>
              {own}
            </>
          ) : path === "organization" ? (
            <>
              <p className="mb-3 text-sm">
                Owner — {workspaceName}. Organization administrators manage the
                connection.
              </p>
              {organizationConnect}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Owner — you. Then grant the organization access via “Access”.
                Creating a connection and granting access are separate actions.
              </p>
              {personalConnect}
            </>
          )}
          <Dialog.Footer>
            <Button
              ref={cancel}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
