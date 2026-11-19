"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@reviewrouter/ui";
import {
  getSetupProvider,
  type SetupProviderId,
} from "../../../src/features/provider-setup/setup-provider";
import { ConnectTargetContext } from "../account-connect-target";
import {
  PersonalConnectPanel,
  usePersonalConnectPlace,
} from "../personal-connect-panel";

/**
 * State of connecting an account inside the provider dialog. The form opens
 * by itself when the provider has no connection here, stays open while the
 * dialog's lists reread, and its open request holds the provider choice.
 */
export function useInlineGatewayConnect({
  available,
  empty,
  onConnected,
}: {
  /** The chosen provider and storage can be connected in place. */
  readonly available: boolean;
  /** No ready connection of this provider here yet. */
  readonly empty: boolean;
  readonly onConnected: (bindingId: string) => void;
}) {
  const place = usePersonalConnectPlace();
  const [open, setOpen] = useState(false);
  const [nonce, setNonce] = useState<string | null>(null);
  const [connectedBinding, setConnectedBinding] = useState<string | null>(null);
  const supported = place !== null && available;
  const show = supported && (open || (empty && connectedBinding === null));
  useEffect(() => {
    // Opened because nothing was there: stay open while the list rereads.
    if (show && !open) setOpen(true);
  }, [show, open]);
  const latest = useRef(onConnected);
  useEffect(() => {
    latest.current = onConnected;
  }, [onConnected]);
  const connected = useCallback((bindingId: string) => {
    setOpen(false);
    setConnectedBinding(bindingId);
    latest.current(bindingId);
  }, []);
  return {
    place,
    supported,
    show,
    /** A request in progress: the provider choice must not change. */
    locked: nonce !== null,
    nonce,
    setNonce,
    connectedBinding,
    connected,
    openForm: () => setOpen(true),
    closeForm: () => setOpen(false),
    /** Another provider, storage or account was chosen. */
    reset: () => {
      setOpen(false);
      setConnectedBinding(null);
    },
  };
}

type InlineGatewayConnectState = ReturnType<typeof useInlineGatewayConnect>;

/**
 * Connecting a provider's account without leaving the provider dialog (79):
 * "New connection" beside the account list, the Connections form narrowed to
 * this provider, and what happens once the new connection is added here.
 */
export function InlineGatewayConnect({
  inline,
  provider,
  empty,
  hasAccounts,
  selectedBinding,
  finishing,
  onRecheck,
  deniedReason,
  disabled,
}: {
  readonly inline: InlineGatewayConnectState;
  readonly provider: SetupProviderId;
  /** No ready connection of this provider here yet. */
  readonly empty: boolean;
  /** Some connection could be chosen instead, so the form can be closed. */
  readonly hasAccounts: boolean;
  readonly selectedBinding: string | undefined;
  /** The new connection is not readable in this workspace yet. */
  readonly finishing: boolean;
  readonly onRecheck: (bindingId: string) => void;
  /** Why this viewer cannot add a connection here, if they cannot. */
  readonly deniedReason: string | undefined;
  readonly disabled: boolean;
}): React.ReactElement | null {
  const { nonce, setNonce, connected, connectedBinding } = inline;
  const target = useMemo(
    () => ({ provider, empty, nonce, setNonce, onConnected: connected }),
    [provider, empty, nonce, setNonce, connected],
  );
  if (!inline.supported) return null;
  const label = getSetupProvider(provider).label;
  return (
    <>
      {connectedBinding !== null && selectedBinding === connectedBinding ? (
        <ConnectedNotice />
      ) : null}
      {finishing && connectedBinding ? (
        <FinishingConnection onRecheck={() => onRecheck(connectedBinding)} />
      ) : null}
      {!inline.show && hasAccounts && !deniedReason ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={disabled}
          onClick={inline.openForm}
        >
          New connection
        </Button>
      ) : null}
      {!inline.show || !inline.place ? null : deniedReason ? (
        <p role="status" className="text-sm text-amber-100/85">
          {deniedReason}
        </p>
      ) : (
        <section
          aria-label={`Connect ${label}`}
          className="grid gap-3 border-t border-cyan-200/10 pt-4"
        >
          <h4 className="text-sm font-semibold text-cyan-50">
            Connect {label}
          </h4>
          <ConnectTargetContext.Provider value={target}>
            <PersonalConnectPanel place={inline.place} />
          </ConnectTargetContext.Provider>
          {hasAccounts && !nonce ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={inline.closeForm}
            >
              Cancel
            </Button>
          ) : null}
        </section>
      )}
    </>
  );
}

/** The form that held focus is gone; the result takes it instead. */
function ConnectedNotice(): React.ReactElement {
  const notice = useRef<HTMLParagraphElement>(null);
  useEffect(() => notice.current?.focus(), []);
  return (
    <p
      ref={notice}
      role="status"
      tabIndex={-1}
      className="text-sm text-emerald-300 outline-none"
    >
      Connected and added to this workspace.
    </p>
  );
}

const recheckAttempts = 20;

/** A just-added connection can wait briefly for its workspace binding. */
function FinishingConnection({
  onRecheck,
}: {
  readonly onRecheck: () => void;
}): React.ReactElement {
  const recheck = useRef(onRecheck);
  useEffect(() => {
    recheck.current = onRecheck;
  }, [onRecheck]);
  const [attempts, setAttempts] = useState(0);
  useEffect(() => {
    if (attempts >= recheckAttempts) return;
    const timer = setTimeout(() => {
      recheck.current();
      setAttempts((value) => value + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [attempts]);
  return attempts < recheckAttempts ? (
    <p role="status" className="text-sm text-slate-400">
      Finishing connection…
    </p>
  ) : (
    <div className="grid gap-2">
      <p role="status" className="text-sm text-slate-400">
        The connection is not ready in this workspace yet.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => {
          recheck.current();
          setAttempts(0);
        }}
      >
        Try again
      </Button>
    </div>
  );
}
