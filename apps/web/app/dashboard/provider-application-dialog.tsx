"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, ServerCog, Settings2 } from "lucide-react";
import {
  Button,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "@reviewrouter/ui";
import type {
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  GatewayRepositoryBatchContent,
  useRepositoryActionSelection,
  type GatewayBatchActions,
} from "./gateway-repository-batch-controls";
import { ProviderApiKeyManagerContent } from "./provider-api-key-manager";

type ProviderApplicationMode = "gateway" | "direct";

export function ProviderApplicationDialog({
  workspaceId,
  accounts,
  enabled,
  directEnabled,
  actions,
}: {
  readonly workspaceId: string;
  readonly accounts: AccountsResult<AccountsPage> | undefined;
  readonly enabled: boolean;
  readonly directEnabled: boolean;
  readonly actions: GatewayBatchActions;
}): React.ReactElement {
  const selection = useRepositoryActionSelection();
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ProviderApplicationMode>("gateway");
  const [gatewayLocked, setGatewayLocked] = useState(false);
  const [directPending, setDirectPending] = useState(false);
  const [directInitialRepositoryIds, setDirectInitialRepositoryIds] = useState<
    readonly string[] | null
  >(null);
  const locked = gatewayLocked || directPending;

  useEffect(() => {
    if (!open) return;
    setDirectInitialRepositoryIds(
      selectionRef.current?.selected.map((target) => target.repositoryId) ??
        [],
    );
  }, [open]);

  return (
    <DialogRoot
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && locked) return;
        if (nextOpen) {
          setMode("gateway");
          setDirectInitialRepositoryIds(
            selectionRef.current?.selected.map(
              (target) => target.repositoryId,
            ) ?? [],
          );
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!enabled}
            title={enabled ? undefined : "Dashboard mutations are unavailable."}
          />
        }
      >
        <Settings2 aria-hidden="true" className="h-4 w-4" />
        Configure providers
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop className="z-50" />
        <DialogPopup className="z-[60] max-h-[90vh] w-[min(96vw,72rem)] overflow-y-auto border-cyan-200/20 bg-[var(--rr-surface-menu)] p-0">
          <DialogClose
            render={
              <button
                type="button"
                disabled={locked}
                className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full border border-cyan-200/15 text-cyan-100 disabled:opacity-50"
                aria-label="Close provider application"
              />
            }
          >
            ×
          </DialogClose>
          <div className="border-b border-cyan-200/10 p-5 pr-14 sm:p-6">
            <DialogTitle className="text-xl font-semibold text-cyan-50">
              Configure providers
            </DialogTitle>
            <DialogDescription className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Choose server-managed account gateway credentials or install a
              repository API key directly into GitHub Actions secrets.
            </DialogDescription>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            <fieldset disabled={locked} className="grid gap-3">
              <legend className="text-sm font-semibold text-cyan-100">
                Application mode
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ModeOption
                  checked={mode === "gateway"}
                  disabled={locked || !enabled}
                  onChange={() => setMode("gateway")}
                  title="Account gateway"
                  description="Server credentials"
                  icon={<ServerCog aria-hidden="true" className="h-4 w-4" />}
                />
                <ModeOption
                  checked={mode === "direct"}
                  disabled={locked || !enabled || !directEnabled}
                  onChange={() => setMode("direct")}
                  title="Repository API key"
                  description="Direct MiMo/OpenRouter GitHub Secrets"
                  icon={<KeyRound aria-hidden="true" className="h-4 w-4" />}
                />
              </div>
            </fieldset>

            <div className="grid gap-6">
              <div hidden={mode !== "gateway"}>
                <GatewayRepositoryBatchContent
                  workspaceId={workspaceId}
                  accounts={accounts}
                  enabled={enabled}
                  actions={actions}
                  onLockedChange={setGatewayLocked}
                />
              </div>
              <div hidden={mode !== "direct"}>
                <ProviderApiKeyManagerContent
                  open={open && directEnabled}
                  workspaceId={workspaceId}
                  embedded
                  initialRepositoryIds={directInitialRepositoryIds}
                  onPendingChange={setDirectPending}
                  disabled={!enabled || !directEnabled}
                  disabledReason={
                    !directEnabled
                      ? "Workspace admin access is required to manage repository API keys."
                      : "Dashboard mutations are unavailable."
                  }
                />
              </div>
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

function ModeOption({
  checked,
  disabled,
  onChange,
  title,
  description,
  icon,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: () => void;
  readonly title: string;
  readonly description: string;
  readonly icon: React.ReactNode;
}): React.ReactElement {
  return (
    <label
      className={[
        "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
        checked
          ? "border-cyan-300/50 bg-cyan-300/[0.08]"
          : "border-cyan-200/10 hover:bg-cyan-300/[0.035]",
      ].join(" ")}
    >
      <input
        type="radio"
        name="provider-application-mode"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-cyan-50">
          {icon}
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-slate-400">
          {description}
        </span>
      </span>
    </label>
  );
}
