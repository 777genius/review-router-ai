"use client";

import { useId, useRef, useState } from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import {
  AccountMenuItem,
  accountMenuItemClass,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import type {
  AccountProfileView,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import type { AccountNativeConnectionIntent } from "../../src/server/native-connection-adapter";
import {
  nativeConnectionFields,
  nativeConnectionInputsAllowed,
  nativeConnectionMethodAllowed,
  nativeConnectionSelection,
  snapshotNativeConnectionInputs,
  type NativeConnectionMethod,
} from "../../src/features/account-gateway/domain/native-connection";
import { suggestedAccountLabel } from "../../src/features/account-gateway/connection-options";

export type NativeConnectionSubmission = {
  intent: Omit<AccountNativeConnectionIntent, "nonce">;
  inputFields: Record<string, string>;
  interaction: NativeConnectionMethod["interaction"]["kind"];
};
const inputClass =
  "min-h-11 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-cyan-50";

/** Three fixed interactions and bounded fields; credentials stay in uncontrolled inputs. */
export function NativeConnectionForm({
  profile,
  account,
  accounts = [],
  disabled,
  disabledReason,
  inline = false,
  selection,
  begin,
}: {
  profile: AccountProfileView;
  account?: Pick<
    AccountView,
    "connectionId" | "gatewayRevision" | "mirrorRevision" | "label"
  >;
  accounts?: readonly AccountView[];
  disabled: boolean;
  disabledReason?: string | undefined;
  inline?: boolean;
  selection?: AccountNativeConnectionIntent["connection"];
  begin(submission: NativeConnectionSubmission): Promise<void>;
}) {
  const methods = (profile.connection?.nativeMethods ?? []).filter(
    (method) =>
      nativeConnectionMethodAllowed(method, account ? "reconnect" : "create") &&
      (!selection ||
        (selection.methodId === method.methodId &&
          selection.methodRevision === method.revision &&
          selection.configurationGeneration ===
            method.configurationGeneration)),
  );
  const [chosen, setChosen] = useState(methods[0]?.methodId ?? "");
  const method =
    methods.find((value) => value.methodId === chosen) ?? methods[0];
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const menuReturnFocus = useAccountMenuReturnFocus();
  const fields = method ? nativeConnectionFields(method) : [];
  const content = (
    <form
      ref={formRef}
      className="mt-4 grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!method || disabled) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        const values = Object.fromEntries(
          fields.flatMap((field) => {
            const value = String(data.get(field.fieldId) ?? "");
            return value ? [[field.fieldId, value]] : [];
          }),
        );
        const label = String(data.get("connectionLabel") ?? "").trim();
        try {
          const inputFields = snapshotNativeConnectionInputs(values);
          if (!nativeConnectionInputsAllowed(method, inputFields))
            throw new Error();
          const intent = {
            connection: nativeConnectionSelection(profile.id, method),
            ...(account
              ? {
                  existing: {
                    connectionId: account.connectionId,
                    gatewayRevision: account.gatewayRevision,
                    mirrorRevision: account.mirrorRevision,
                  },
                }
              : {
                  label:
                    label ||
                    suggestedAccountLabel(
                      profile.label,
                      accounts.map((row) => row.label),
                    ),
                }),
          };
          form.reset();
          fields.forEach((field) => data.delete(field.fieldId));
          setError("");
          setOpen(false);
          void begin({
            intent,
            inputFields,
            interaction: method.interaction.kind,
          });
        } catch {
          form.reset();
          setError(
            "Check the required fields and their size limits, then enter them again.",
          );
        }
      }}
    >
      {methods.length > 1 ? (
        <SelectField
          name="nativeConnectionMethod"
          label="Connection method"
          value={method?.methodId ?? ""}
          onValueChange={(value) => {
            formRef.current?.reset();
            setError("");
            setChosen(value);
          }}
          options={methods.map((value) => ({
            value: value.methodId,
            label: value.label,
          }))}
        />
      ) : (
        <p className="text-sm text-slate-300">
          {method?.label ?? "No connection method is currently available."}
        </p>
      )}
      {method?.interaction.kind === "browser" ? (
        <p className="text-sm text-slate-400">
          A browser tab opens for sign-in.{" "}
          {method.interaction.callbackMode === "manual"
            ? "Return here to complete authorization."
            : "Return here after signing in."}
        </p>
      ) : null}
      {method?.interaction.kind === "device" ? (
        <p className="text-sm text-slate-400">
          You will receive a code and a sign-in address.
        </p>
      ) : null}
      {fields.map((field) =>
        field.kind === "select" ? (
          <SelectField
            key={`${method!.methodId}:${field.fieldId}`}
            name={field.fieldId}
            label={field.label}
            defaultValue=""
            disabled={disabled}
            options={[
              {
                value: "",
                label: field.required
                  ? "Select an option"
                  : "Use provider default",
              },
              ...(field.choices ?? []),
            ]}
          />
        ) : (
          <label
            key={`${method!.methodId}:${field.fieldId}`}
            className="grid gap-2 text-sm"
          >
            {field.label}
            {field.kind === "document" ? (
              <textarea
                name={field.fieldId}
                className={`${inputClass} min-h-32 py-3`}
                required={field.required}
                maxLength={field.maxBytes}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? errorId : undefined}
              />
            ) : (
              <input
                name={field.fieldId}
                className={inputClass}
                type={field.kind === "secret" ? "password" : "text"}
                required={field.required}
                maxLength={field.maxBytes}
                disabled={disabled}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? errorId : undefined}
              />
            )}
            {field.help ? (
              <span className="text-xs text-slate-400">{field.help}</span>
            ) : null}
          </label>
        ),
      )}
      {!account ? (
        <label className="grid gap-2 text-sm">
          Connection name
          <input
            className={inputClass}
            name="connectionLabel"
            defaultValue={suggestedAccountLabel(
              profile.label,
              accounts.map((row) => row.label),
            )}
            maxLength={120}
            disabled={disabled}
          />
        </label>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-amber-200">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={disabled || !method}>
        {account ? "Reconnect" : "Connect"} {profile.label}
      </Button>
    </form>
  );
  if (inline) return content;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) formRef.current?.reset();
        setOpen(value);
        setError("");
      }}
    >
      <AccountMenuItem>
        <Dialog.Trigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className={accountMenuItemClass}
              disabled={disabled}
              title={disabledReason}
            />
          }
        >
          Reconnect
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup finalFocus={menuReturnFocus}>
          <Dialog.CloseButton label="Close connection form" />
          <Dialog.Title>Reconnect {profile.label}</Dialog.Title>
          <Dialog.Description>
            {account?.label}. Choose a connection method to update
            authentication.
          </Dialog.Description>
          {content}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
