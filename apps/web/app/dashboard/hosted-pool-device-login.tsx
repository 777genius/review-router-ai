"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { Copy, ExternalLink, Plus } from "lucide-react";
import { Button, LinkButton } from "@reviewrouter/ui";
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

export type HostedPoolDeviceLoginFlight = {
  readonly loginId: string;
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: string;
  readonly intervalMs: number;
};

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
  previewFlight,
}: {
  readonly workspaceId: string;
  readonly mutationsEnabled: boolean;
  readonly enrolled?: boolean;
  readonly header?: ReactNode;
  readonly children?: ReactNode;
  readonly startAction: DeviceLoginAction<HostedPoolDeviceLoginStartResult>;
  readonly pollAction: DeviceLoginAction<HostedPoolDeviceLoginPollResult>;
  readonly previewFlight?: HostedPoolDeviceLoginFlight | undefined;
}): React.ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [flight, setFlight] = useState<HostedPoolDeviceLoginFlight | null>(
    previewFlight ?? null,
  );
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
    <form action={start} className="grid gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="priority" value="100" />
      <label className="grid gap-2 text-sm text-slate-300">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Account name
        </span>
        <input
          name="label"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="Work laptop"
          className={fieldClassName}
        />
      </label>
      <FormSubmitButton
        variant="outline"
        size="sm"
        className="w-fit min-h-11 whitespace-nowrap text-cyan-50"
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
          title="ChatGPT connected"
          body="ReviewRouter detected the login. This account is ready for reviews. Credentials stay on the server."
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
    <DeviceLoginWaitingPanel
      userCode={flight.userCode}
      verificationUrl={flight.verificationUrl}
      expiresAt={flight.expiresAt}
    />
  ) : null;

  const addFormPanel = (
    <div className="rounded-2xl border border-cyan-200/15 bg-slate-950/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-sm font-semibold text-cyan-50">Sign in with ChatGPT</p>
      <p className="mt-1 text-sm leading-6 text-slate-400">
        You will enter a short code in ChatGPT. We detect the login
        automatically. Credentials never go to the browser.
      </p>
      <div className="mt-4">{startForm}</div>
    </div>
  );

  if (enrolled) {
    return (
      <div className="mt-5 grid gap-3">
        <div className="grid gap-3">
          {header}
          {flight ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit max-w-full whitespace-nowrap text-cyan-50"
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
          Credentials never go to the browser.
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
          <p className="text-sm leading-6 text-slate-400">
            You will enter a short code in ChatGPT. We detect the login
            automatically. Credentials never go to the browser.
          </p>
          {startForm}
        </div>
      )}
      {flight ? null : (
        <p className="text-sm text-slate-400">
          Connect ChatGPT to get started. No repository can use hosted reviews
          until an account is ready.
        </p>
      )}
    </div>
  );
}

function DeviceLoginWaitingPanel({
  userCode,
  verificationUrl,
  expiresAt,
}: {
  readonly userCode: string;
  readonly verificationUrl: string;
  readonly expiresAt: string;
}): React.ReactElement {
  const remainingLabel = useLiveExpiryLabel(expiresAt);
  const [copied, setCopied] = useState(false);

  async function copyCode(): Promise<void> {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_400);
  }

  return (
    <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.05] p-5 shadow-[inset_0_1px_0_rgba(103,232,249,0.08)]">
      <p className="text-sm font-semibold text-cyan-50">
        Enter this code in ChatGPT
      </p>
      <p className="mt-1 text-sm leading-6 text-slate-300">
        Open ChatGPT, type the code there, then come back. Credentials stay on
        the server.
      </p>
      <ol className="mt-5 grid gap-5">
        <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          <StepNumber n={1} />
          <div>
            <p className="text-sm font-medium text-cyan-50">Open ChatGPT</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Continue on ChatGPT&apos;s device login page. Do not paste
              passwords or session files here.
            </p>
            <LinkButton
              href={verificationUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3"
            >
              Open ChatGPT
              <ExternalLink aria-hidden="true" className="h-4 w-4" />
            </LinkButton>
          </div>
        </li>
        <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          <StepNumber n={2} />
          <div>
            <p className="text-sm font-medium text-cyan-50">Enter this code</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="break-all font-mono text-4xl font-semibold tracking-[0.18em] text-cyan-50 sm:text-5xl">
                {userCode}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void copyCode();
                }}
              >
                <Copy aria-hidden="true" className="h-4 w-4" />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </div>
        </li>
        <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
          <StepNumber n={3} />
          <div>
            <p className="text-sm font-medium text-cyan-50">
              Stay on this page
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              We detect the login automatically and import the session. You
              never paste credentials here.
            </p>
          </div>
        </li>
      </ol>
      <p className="mt-5 text-xs text-slate-400" aria-live="polite">
        {remainingLabel}
      </p>
    </div>
  );
}

function StepNumber({ n }: { readonly n: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border border-cyan-200/25 bg-slate-950/80 font-mono text-xs font-semibold text-cyan-100"
    >
      {n}
    </span>
  );
}

function useLiveExpiryLabel(expiresAt: string): string {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);
  return deviceLoginExpiryCopy(expiresAt, nowMs);
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
    case "hosted_account_subject_already_enrolled":
      return "This ChatGPT is already on the list, or it was removed and cannot be added again.";
    case "not_workspace_admin":
    case "workspace_mutation_forbidden":
      return "Your GitHub user is not an owner/admin for this workspace.";
    default:
      return "The dashboard action could not be completed.";
  }
}

function deviceLoginExpiryCopy(expiresAt: string, nowMs = Date.now()): string {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return "This code will expire soon.";
  }
  const remainingMs = expiresMs - nowMs;
  if (remainingMs <= 0) {
    return "This code expired. Start a new sign-in.";
  }
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `This code expires in ${minutes}:${String(seconds).padStart(2, "0")}.`;
}
