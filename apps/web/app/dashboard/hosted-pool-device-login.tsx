"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@reviewrouter/ui";
import { FormSubmitButton } from "../form-submit-button";
import { ActionToast } from "../action-toast";

export type HostedPoolDeviceLoginStartResult =
  | {
      readonly ok: true;
      readonly loginId: string;
      readonly userCode: string;
      readonly verificationUrl: string;
      readonly expiresAt: string;
      readonly intervalSeconds: number;
    }
  | { readonly ok: false; readonly params: Record<string, string> };

export type HostedPoolDeviceLoginPollResult =
  | {
      readonly ok: true;
      readonly status: "pending";
      readonly loginId: string;
      readonly userCode: string;
      readonly verificationUrl: string;
      readonly expiresAt: string;
    }
  | {
      readonly ok: true;
      readonly status: "imported";
      readonly params: Record<string, string>;
    }
  | { readonly ok: false; readonly params: Record<string, string> };

type DeviceLoginAction<Result> = (formData: FormData) => Promise<Result>;

const fieldClassName =
  "min-h-11 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 text-cyan-50 outline-none focus:border-cyan-200/40";

export function HostedPoolDeviceLogin({
  workspaceId,
  mutationsEnabled,
  enrolled = false,
  header,
  children,
  startAction,
  pollAction,
}: {
  readonly workspaceId: string;
  readonly mutationsEnabled: boolean;
  readonly enrolled?: boolean;
  readonly header?: ReactNode;
  readonly children?: ReactNode;
  readonly startAction: DeviceLoginAction<HostedPoolDeviceLoginStartResult>;
  readonly pollAction: DeviceLoginAction<HostedPoolDeviceLoginPollResult>;
}): React.ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [flight, setFlight] = useState<{
    readonly loginId: string;
    readonly userCode: string;
    readonly verificationUrl: string;
    readonly expiresAt: string;
    readonly intervalMs: number;
  } | null>(null);
  const pollActionRef = useRef(pollAction);
  pollActionRef.current = pollAction;

  useEffect(() => {
    if (!flight) return;
    const form = new FormData();
    form.set("workspaceId", workspaceId);
    form.set("loginId", flight.loginId);
    let cancelled = false;
    const tick = async () => {
      const result = await pollActionRef.current(form);
      if (cancelled) return;
      if (!result.ok) {
        setError(result.params.error ?? "hosted_pool_action_failed");
        setFlight(null);
        return;
      }
      if (result.status === "imported") {
        setImported(true);
        setFlight(null);
        setAddOpen(false);
        startTransition(() => router.refresh());
        return;
      }
      setFlight((current) => {
        if (
          !current ||
          (current.userCode === result.userCode &&
            current.verificationUrl === result.verificationUrl &&
            current.expiresAt === result.expiresAt)
        ) {
          return current;
        }
        return {
          ...current,
          userCode: result.userCode,
          verificationUrl: result.verificationUrl,
          expiresAt: result.expiresAt,
        };
      });
    };
    const interval = setInterval(() => {
      void tick();
    }, flight.intervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [flight?.loginId, flight?.intervalMs, router, workspaceId]);

  async function start(formData: FormData): Promise<void> {
    setError(null);
    setImported(false);
    const result = await startAction(formData);
    if (!result.ok) {
      setError(result.params.error ?? "hosted_pool_action_failed");
      setFlight(null);
      return;
    }
    setFlight({
      loginId: result.loginId,
      userCode: result.userCode,
      verificationUrl: result.verificationUrl,
      expiresAt: result.expiresAt,
      intervalMs: Math.max(3_000, result.intervalSeconds * 1_000),
    });
  }

  const startForm = (
    <form
      action={start}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label className="grid gap-2 text-sm text-slate-300">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Account label
        </span>
        <input
          name="label"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Primary"
          className={fieldClassName}
        />
      </label>
      <label className="grid gap-2 text-sm text-slate-300">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Priority
        </span>
        <input
          name="priority"
          type="number"
          min={0}
          defaultValue={100}
          required
          className={fieldClassName}
        />
      </label>
      <FormSubmitButton
        variant="outline"
        size="sm"
        className="min-h-11 whitespace-nowrap"
        disabled={!mutationsEnabled}
        idleLabel="Start ChatGPT sign-in"
        pendingLabel="Starting..."
      />
    </form>
  );

  const toasts = (
    <>
      {imported ? (
        <ActionToast
          tone="success"
          title="Hosted Codex account added"
          body="The ChatGPT session is enrolled in this workspace pool. Credentials stay on the server."
        />
      ) : null}
      {error ? (
        <ActionToast
          tone="danger"
          title="Action needs attention"
          body={deviceLoginErrorText(error)}
        />
      ) : null}
    </>
  );

  const codePanel = flight ? (
    <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.05] p-5 text-sm text-slate-300 shadow-[inset_0_1px_0_rgba(103,232,249,0.08)]">
      <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-cyan-200">
        ChatGPT device login
      </p>
      <p className="mt-3">
        Open{" "}
        <a
          href={flight.verificationUrl}
          target="_blank"
          rel="noreferrer"
          className="text-cyan-200 underline"
        >
          {flight.verificationUrl}
        </a>{" "}
        and enter this code:
      </p>
      <p className="mt-3 font-mono text-2xl tracking-[0.2em] text-cyan-50">
        {flight.userCode}
      </p>
      <p className="mt-3 text-xs text-slate-400">
        Waiting for ChatGPT. {deviceLoginExpiryCopy(flight.expiresAt)} Session
        secrets stay on the server.
      </p>
    </div>
  ) : null;

  const addFormPanel = (
    <div className="rounded-2xl border border-cyan-200/15 bg-slate-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-sm font-semibold text-cyan-50">Sign in with ChatGPT</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">
        Enroll another attached session. Credentials never go to the browser.
      </p>
      <div className="mt-4">{startForm}</div>
    </div>
  );

  if (enrolled) {
    return (
      <div className="mt-5 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {header}
          {flight ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
              disabled={!mutationsEnabled}
              aria-expanded={addOpen}
              onClick={() => setAddOpen((open) => !open)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Add another ChatGPT account
            </Button>
          )}
        </div>
        <p className="text-xs leading-5 text-slate-500">
          Sign in with ChatGPT to enroll another session. Credentials never go
          to the browser.
        </p>
        {toasts}
        {children}
        {flight ? codePanel : addOpen ? addFormPanel : null}
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-3 border-t border-cyan-200/10 pt-5">
      {toasts}
      {flight ? (
        codePanel
      ) : (
        <div className="grid gap-3">
          <p className="text-sm font-semibold text-cyan-50">
            Sign in with ChatGPT
          </p>
          {startForm}
        </div>
      )}
    </div>
  );
}

function deviceLoginErrorText(error: string): string {
  switch (error) {
    case "hosted_pool_device_login_in_flight":
      return "A ChatGPT sign-in is already waiting for this workspace. Finish or wait for it to expire.";
    case "hosted_pool_device_login_expired":
      return "That ChatGPT sign-in expired. Start a new one from the dashboard.";
    case "hosted_pool_device_login_denied":
      return "ChatGPT sign-in was denied. Start a new one if you still want to enroll this account.";
    case "hosted_pool_device_login_artifact_invalid":
    case "hosted_codex_auth_json_invalid":
    case "hosted_account_auth_file_invalid":
      return "The ChatGPT session could not be imported. Start a new sign-in or upload a fresh auth.json.";
    case "hosted_pool_device_login_provider_unavailable":
      return "ChatGPT sign-in is temporarily unavailable. Try again shortly, or upload auth.json.";
    case "not_workspace_admin":
    case "workspace_mutation_forbidden":
      return "Your GitHub user is not an owner/admin for this workspace.";
    default:
      return "The dashboard action could not be completed.";
  }
}

function deviceLoginExpiryCopy(expiresAt: string): string {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return "This code will expire soon.";
  }
  const remainingMs = expiresMs - Date.now();
  const expiryLabel = new Date(expiresMs).toISOString().slice(11, 16);
  if (remainingMs <= 0) {
    return `This code expired at ${expiryLabel} UTC.`;
  }
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `This code expires in ${minutes} minute${minutes === 1 ? "" : "s"} (${expiryLabel} UTC).`;
}
