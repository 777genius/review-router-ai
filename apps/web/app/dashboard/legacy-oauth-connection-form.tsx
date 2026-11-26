"use client";

import { useId, useRef, useState } from "react";
import { Button, Dialog, SelectField } from "@reviewrouter/ui";
import {
  connectionMethodAllowed,
  credentialImportMethods,
  type CredentialImportMethod,
} from "../../src/features/account-gateway/connection-capabilities";
import {
  CredentialImportFields,
  credentialImportLabels,
  validCredentialImportText,
} from "./credential-import-fields";
import {
  AccountMenuItem,
  accountMenuItemClass,
  useAccountMenuReturnFocus,
} from "./account-actions-menu";
import { suggestedAccountLabel } from "../../src/features/account-gateway/connection-options";
import {
  oauthCompletionPresentation,
  type OAuthCompletionPresentation,
} from "./account-connection-presentation";
import type {
  AccountIntent,
  AccountOAuthIntent,
  AccountOAuthReconnectIntent,
  AccountProfileView,
  AccountView,
} from "../../src/server/account-gateway-accounts";

export type OAuthFormIntent =
  | Omit<AccountOAuthIntent, "nonce">
  | Omit<AccountOAuthReconnectIntent, "nonce">;
type ManagementScope = "workspace" | "personal";
const inputClass =
  "min-h-11 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-cyan-50";
// Explicit v1/v2 compatibility UI. Native v3 methods use the bounded native form.
export function OAuthForm({
  inline = false,
  account,
  accounts = [],
  profiles,
  disabled,
  disabledReason,
  begin,
  submit,
  managementScope = "workspace",
}: {
  inline?: boolean;
  account?: AccountView;
  accounts?: AccountView[];
  profiles: AccountProfileView[];
  disabled: boolean;
  disabledReason?: string | undefined;
  begin(intent: OAuthFormIntent): Promise<void>;
  submit(
    intent: Omit<AccountIntent, "nonce">,
    credential?: string,
  ): Promise<void>;
  managementScope?: ManagementScope;
}) {
  const menuReturnFocus = useAccountMenuReturnFocus();
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState(
    account?.profileId ?? profiles[0]?.id ?? "",
  );
  const profile =
    profiles.find((candidate) => candidate.id === profileId) ?? profiles[0];
  const action = account ? "reconnect" : "create";
  const methods = profile
    ? (
        profile.oauthMethods ??
        (profile.id === "openai-codex-oauth-responses-v1" && !profile.connection
          ? (["device_code", "browser"] as const)
          : (["browser"] as const))
      ).filter((method) => connectionMethodAllowed(profile, action, method))
    : [];
  const imports = profile ? credentialImportMethods(profile, action) : [];
  type Method = "device_code" | "browser" | CredentialImportMethod;
  const [chosenMethod, setMethod] = useState<Method>(
    methods[0] ?? imports[0] ?? "browser",
  );
  const choices: Method[] = [...methods, ...imports];
  const method = choices.includes(chosenMethod) ? chosenMethod : choices[0];
  const importMethod =
    method === "refresh_token" || method === "oauth_auth_json"
      ? method
      : undefined;
  const [importLoading, setImportLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const importErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  function chooseMethod(value: Method) {
    formRef.current
      ?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >('[name="credential"], [name="credentialFile"]')
      .forEach((field) => {
        field.value = "";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    setImportLoading(false);
    setImportError("");
    setMethod(value);
  }
  const providerLabel = profile?.label ?? account?.profileLabel ?? "provider";
  const connectText =
    profiles.length > 1
      ? "Connect with OAuth"
      : `Connect ${providerLabel} OAuth`;
  const reconnectText = `Refresh ${providerLabel} sign-in`;
  const fields = (
    <form
      ref={formRef}
      className="mt-4 grid gap-4"
      onInput={() => setImportError("")}
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        if (!method || importLoading) return;
        setImportError("");
        if (importMethod) {
          const credential = String(values.get("credential") ?? "");
          if (!validCredentialImportText(credential)) {
            setImportError("Enter valid text of 64 KiB or smaller.");
            return;
          }
          const intent: Omit<AccountIntent, "nonce"> = account
            ? {
                kind: "reconnect",
                connectionId: account.connectionId,
                gatewayRevision: account.gatewayRevision,
                mirrorRevision: account.mirrorRevision,
                credentialImportMethod: importMethod,
              }
            : {
                kind: "connect",
                profileId: profile!.id,
                label:
                  String(values.get("label") ?? "").trim() ||
                  suggestedAccountLabel(
                    providerLabel,
                    accounts.map((item) => item.label),
                  ),
                credentialImportMethod: importMethod,
              };
          form.reset();
          values.delete("credential");
          values.delete("credentialFile");
          setOpen(false);
          void submit(intent, credential);
          return;
        }
        if (method !== "browser" && method !== "device_code") return;
        const intent: OAuthFormIntent = account
          ? {
              method,
              connectionId: account.connectionId,
              gatewayRevision: account.gatewayRevision,
              mirrorRevision: account.mirrorRevision,
            }
          : {
              method,
              profileId: String(values.get("profileId") ?? ""),
              label:
                String(values.get("label") ?? "").trim() ||
                suggestedAccountLabel(
                  providerLabel,
                  accounts.map((a) => a.label),
                ),
            };
        form.reset();
        setOpen(false);
        void begin(intent);
      }}
    >
      {imports.length ? (
        <SelectField
          name="connectionMethod"
          label="Sign-in method"
          value={method ?? ""}
          onValueChange={(value) => chooseMethod(value as Method)}
          options={choices.map((value) => ({
            value,
            label:
              value === "device_code"
                ? "Device code"
                : value === "browser"
                  ? "Browser sign-in"
                  : `Import ${credentialImportLabels[value]}`,
          }))}
        />
      ) : null}
      {importMethod ? (
        <CredentialImportFields
          key={importMethod}
          method={importMethod}
          loading={setImportLoading}
          validationErrorId={importError ? importErrorId : undefined}
        />
      ) : method === "browser" || method === "device_code" ? (
        <OAuthMethodChoice
          key={profile?.id}
          method={method}
          methods={imports.length ? [method] : methods}
          completionKind={
            profile?.connection?.completionInputKind ??
            oauthCompletionPresentation(profile)?.inputKind ??
            "callback_url"
          }
          change={chooseMethod}
        />
      ) : (
        <p role="status">No sign-in method is currently available.</p>
      )}
      {importError ? (
        <p id={importErrorId} role="alert" className="text-sm text-amber-200">
          {importError}
        </p>
      ) : null}
      {!account ? (
        <>
          {!inline ? (
            <SelectField
              name="profileId"
              label="Provider profile"
              defaultValue={profileId}
              onValueChange={(id) => {
                setProfileId(id);
                const selected = profiles.find(
                  (candidate) => candidate.id === id,
                );
                chooseMethod(
                  selected?.oauthMethods?.[0] ??
                    (selected?.id === "openai-codex-oauth-responses-v1" &&
                    !selected?.connection
                      ? "device_code"
                      : "browser"),
                );
              }}
              options={profiles.map((p) => ({
                value: p.id,
                label: p.label,
                ...(p.connection?.planLabel
                  ? { description: p.connection.planLabel }
                  : {}),
              }))}
            />
          ) : (
            <input
              type="hidden"
              name="profileId"
              value={profiles[0]?.id ?? ""}
            />
          )}
          <label className="grid gap-2 text-sm">
            Connection name
            <input
              className={inputClass}
              name="label"
              key={profile?.id}
              defaultValue={suggestedAccountLabel(
                providerLabel,
                accounts.map((a) => a.label),
              )}
              maxLength={120}
            />
          </label>
        </>
      ) : (
        <p className="text-sm text-slate-300">{account.label}</p>
      )}
      <Button type="submit" disabled={disabled || importLoading || !method}>
        {importLoading
          ? "Reading file…"
          : importMethod
            ? `Import ${credentialImportLabels[importMethod]}`
            : `Sign in to ${providerLabel}`}
      </Button>
    </form>
  );
  if (inline) return fields;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          formRef.current?.reset();
          setImportLoading(false);
          setImportError("");
        }
        setOpen(next);
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
              title={disabled ? disabledReason : undefined}
            />
          }
        >
          {account ? reconnectText : connectText}
        </Dialog.Trigger>
      </AccountMenuItem>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Popup finalFocus={menuReturnFocus}>
          <Dialog.Title>
            {account ? `${reconnectText} · ${account.label}` : connectText}
          </Dialog.Title>
          <Dialog.Description>
            {`Sign in with your ${providerLabel} account. No API key is needed.`}
            {account
              ? " Your existing connection is kept until sign-in is confirmed."
              : ""}
            {managementScope === "personal"
              ? " This is your canonical personal connection. Its name is visible wherever you explicitly share it; authentication is shared across all authorized uses."
              : ""}
          </Dialog.Description>
          {fields}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OAuthMethodChoice({
  method,
  methods,
  completionKind,
  change,
}: {
  method: "device_code" | "browser";
  methods: readonly ("device_code" | "browser")[];
  completionKind: "none" | OAuthCompletionPresentation["inputKind"];
  change(value: "device_code" | "browser"): void;
}) {
  return (
    <div className="space-y-3">
      {methods.length > 1 ? (
        <SelectField
          name="oauthMethod"
          label="Sign-in method"
          value={method}
          onValueChange={(value) => change(value as "device_code" | "browser")}
          options={[
            ...(methods.includes("device_code")
              ? [
                  {
                    value: "device_code",
                    label: "Device code",
                    description: "Recommended · enter a short code at OpenAI",
                  },
                ]
              : []),
            {
              value: "browser",
              label:
                completionKind === "authorization_code"
                  ? "Browser sign-in"
                  : "Browser callback",
              description:
                completionKind === "authorization_code"
                  ? "Paste the authorization code after sign-in"
                  : "Fallback · paste the authorization result address",
            },
          ]}
        />
      ) : (
        <p className="text-sm text-slate-400">
          {method === "device_code" ? "Device code sign-in" : "Browser sign-in"}
        </p>
      )}
      {method === "device_code" ? (
        <p className="text-sm text-slate-400">
          First enable device code login at{" "}
          <a
            className="text-cyan-200 underline"
            href="https://chatgpt.com/settings/security"
            target="_blank"
            rel="noopener noreferrer"
          >
            ChatGPT Settings → Security
          </a>{" "}
          (at the bottom of the page).
        </p>
      ) : (
        <p className="text-sm text-slate-400">
          {completionKind === "none"
            ? "A browser tab opens for sign-in. Return here when you finish."
            : completionKind === "authorization_code"
              ? "Paste the full authorization code shown after sign-in to finish."
              : "A browser tab opens for sign-in. Paste its final address here to finish."}
        </p>
      )}
    </div>
  );
}
