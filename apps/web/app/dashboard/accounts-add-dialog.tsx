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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger render={<Button variant="outline" />}>
        {accountsCopy.add}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="z-[60]" />
        <Dialog.Popup
          initialFocus={cancel}
          className="z-[61] w-[min(92vw,44rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto"
        >
          <Dialog.Title className="text-lg font-semibold">
            {accountsCopy.add}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-slate-400">
            Выберите подключение и его владельца. Доступ организации не передаёт
            владение и не меняет выбор в Models.
          </Dialog.Description>
          <div className="my-4">
            <SelectField
              name="connectionOwnership"
              label="Способ добавления"
              defaultValue="personal"
              onValueChange={setPath}
              options={[
                {
                  value: "personal",
                  label: "Подключить новое · личное, принадлежит вам",
                },
                { value: "existing", label: "Использовать мое подключение" },
                {
                  value: "organization",
                  label: `Подключить новое · принадлежит ${workspaceName}`,
                },
              ]}
            />
          </div>
          {path === "existing" ? (
            <>
              <p className="mb-3 text-sm text-slate-400">
                В строке выберите «Доступ», затем добавьте {workspaceName}. Уже
                выданный доступ показан отдельно.
              </p>
              {own}
            </>
          ) : path === "organization" ? (
            <>
              <p className="mb-3 text-sm">
                Владелец: {workspaceName}. Управлять подключением смогут
                администраторы организации.
              </p>
              {organizationConnect}
            </>
          ) : (
            <>
              <p className="mb-3 text-sm">
                Владелец: вы. После подключения выдайте организации доступ через
                «Доступ» в своей inventory. Создание подключения и выдача
                доступа - отдельные действия.
              </p>
              {personalConnect}
            </>
          )}
          <div className="mt-5 flex justify-end">
            <Button
              ref={cancel}
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Закрыть
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
