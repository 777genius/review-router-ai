import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Badge } from "@reviewrouter/ui";
import {
  GitHubSignInButton,
  GitLabSignInButton,
} from "../../github-sign-in-button";
import { LogoMark } from "../../logo-mark";
import { SourceProviderLogo } from "../../source-provider-logo";
import { createNoIndexPageMetadata } from "../../seo";
import {
  isGitHubAuthConfigured,
  isGitLabAuthConfigured,
} from "../../../src/auth/auth-env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Sign in",
  description:
    "Sign in to ReviewRouter to see your repositories, setup status, and review history.",
});

type SignInPageProps = {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
};

type SignInIssue = {
  readonly badge: string;
  readonly title: string;
  readonly body: string;
  readonly nextStep?: string;
  readonly tone: "warning" | "success";
};

const signInIssues: Record<string, SignInIssue> = {
  OAuthCallback: {
    badge: "Source connected",
    title: "Finish dashboard sign-in",
    body: "GitHub returned from the App installation before dashboard sign-in had started. Continue below to link your account.",
    nextStep:
      "If this keeps happening, turn off “Request user authorization (OAuth) during installation” in the GitHub App settings and keep the setup URL pointed at /setup.",
    tone: "success",
  },
  OAuthSignin: {
    badge: "Sign-in issue",
    title: "Sign-in could not start",
    body: "The source provider did not accept the request. Check the OAuth client settings and try again.",
    tone: "warning",
  },
  AccessDenied: {
    badge: "Access denied",
    title: "The source provider said no",
    body: "Use an account that can open the workspace or repository you need.",
    tone: "warning",
  },
  Configuration: {
    badge: "Configuration issue",
    title: "Sign-in is not configured correctly",
    body: "Contact support and include this page URL.",
    tone: "warning",
  },
};

export default async function SignInPage({
  searchParams,
}: SignInPageProps): Promise<React.ReactElement> {
  const params = searchParams ? await searchParams : {};
  const callbackUrl = readSafeCallbackUrl(readParam(params.callbackUrl));
  const error = readParam(params.error);
  const issue = error
    ? (signInIssues[error] ?? signInIssues.Configuration)
    : null;
  const githubConfigured = isGitHubAuthConfigured();
  const gitlabConfigured = isGitLabAuthConfigured();

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-14">
      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center lg:gap-6">
        <section
          aria-labelledby="signin-title"
          className="relative isolate overflow-hidden rounded-[1.8rem] border border-cyan-200/14 bg-[var(--rr-surface-panel)] p-6 sm:p-8 lg:p-10"
        >
          <div
            aria-hidden="true"
            className="home-boundary-map__grid absolute inset-0 -z-10"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent"
          />

          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-300">
            Access checkpoint ///
          </p>
          <h1
            id="signin-title"
            className="mt-4 text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-cyan-50 text-pretty sm:text-5xl"
          >
            Sign in to{" "}
            <span className="whitespace-nowrap text-lime-300">
              ReviewRouter
            </span>
          </h1>
          <p className="mt-4 max-w-lg text-base leading-7 text-slate-300 text-pretty">
            One click proves it&apos;s you. We use your source account to show
            your repositories and review status — nothing else.
          </p>

          <SignInRoute />

          <ul className="mt-8 hidden gap-3 lg:grid">
            <Guarantee
              icon={<ShieldCheck aria-hidden="true" className="size-4" />}
              title="Repository info only"
              body="Pull request titles and check results. Not your source code or diffs."
            />
            <Guarantee
              icon={<KeyRound aria-hidden="true" className="size-4" />}
              title="No model keys here"
              body="Codex, Claude, MiMo, and OpenRouter keys are set up later — in your CI or our encrypted account pool."
            />
            <Guarantee
              icon={<LockKeyhole aria-hidden="true" className="size-4" />}
              title="No new password"
              body="Your GitHub or GitLab account is the only thing you need to remember."
            />
          </ul>

          <p className="mt-8 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-slate-500">
            RR /// auth gate 1.0
          </p>
        </section>

        <section
          aria-labelledby="signin-panel-title"
          className="relative isolate overflow-hidden rounded-[1.8rem] border border-cyan-300/[0.16] bg-[var(--rr-surface-card-strong)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.42),0_0_90px_-54px_rgba(0,240,255,0.9)] backdrop-blur-2xl sm:p-8 lg:self-center"
        >
          <div
            aria-hidden="true"
            className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-lime-200/60 to-transparent"
          />

          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2.5">
              <LogoMark size="xs" />
              <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
                ReviewRouter
              </span>
            </span>
            <Badge tone={issue ? issue.tone : "accent"}>Sign in</Badge>
          </div>

          <h2
            id="signin-panel-title"
            className="mt-6 text-2xl font-semibold tracking-tight text-cyan-50 sm:text-[1.7rem]"
          >
            Continue to your dashboard
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Pick the account you already use for code. It takes one click.
          </p>

          {issue ? <IssueNotice issue={issue} /> : null}

          <div className="mt-6 grid gap-3">
            <GitHubSignInButton
              callbackUrl={callbackUrl}
              size="lg"
              className="w-full rounded-2xl"
              disabled={!githubConfigured}
            >
              <span className="inline-flex items-center justify-center gap-2">
                {githubConfigured
                  ? "Continue with GitHub"
                  : "GitHub sign-in unavailable"}
              </span>
            </GitHubSignInButton>
            {gitlabConfigured ? (
              <GitLabSignInButton
                callbackUrl={callbackUrl}
                size="lg"
                variant="outline"
                className="w-full rounded-2xl"
              >
                <span className="inline-flex items-center justify-center gap-2">
                  Continue with GitLab
                </span>
              </GitLabSignInButton>
            ) : null}
          </div>

          {!githubConfigured && !gitlabConfigured ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100"
            >
              No source provider is configured on this server yet. Ask your
              operator to add GitHub or GitLab credentials.
            </p>
          ) : null}

          <p className="mt-4 flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.12em] text-slate-500">
            <ArrowUpRight
              aria-hidden="true"
              className="size-3.5 text-cyan-300"
            />
            You&apos;ll land on{" "}
            <span
              className="max-w-[14rem] truncate text-cyan-200 normal-case"
              title={callbackUrl}
            >
              {callbackUrl}
            </span>
          </p>

          <div className="mt-6 border-t border-cyan-200/10 pt-5">
            <p className="flex items-start gap-2.5 text-xs leading-5 text-slate-400">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-lime-300"
              />
              No secrets stored here. Sign-in connects your account and
              repository info — no code, no diffs, no model keys.
            </p>
          </div>

          <div className="mt-5 flex items-center justify-between gap-4 text-sm">
            <Link
              href="/"
              className="rounded-lg text-slate-400 underline-offset-4 transition hover:text-cyan-50 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              Back to home
            </Link>
            <Link
              href="/support"
              className="rounded-lg text-slate-400 underline-offset-4 transition hover:text-cyan-50 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            >
              Need help?
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function SignInRoute(): React.ReactElement {
  return (
    <div className="signin-route mt-8" aria-hidden="true">
      <div className="signin-route__node">
        <span className="signin-route__icon">
          <UserRound className="size-5" />
        </span>
        <span className="signin-route__label">You</span>
      </div>
      <span className="signin-route__line">
        <span className="signin-route__dot" />
      </span>
      <div className="signin-route__node">
        <span className="signin-route__icon">
          <SourceProviderLogo provider="github" className="size-6" />
        </span>
        <span className="signin-route__label">Source</span>
      </div>
      <span className="signin-route__line">
        <span className="signin-route__dot signin-route__dot--delayed" />
      </span>
      <div className="signin-route__node signin-route__node--accent">
        <span className="signin-route__icon">
          <LogoMark size="xs" />
        </span>
        <span className="signin-route__label">Dashboard</span>
      </div>
    </div>
  );
}

function Guarantee({
  icon,
  title,
  body,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly body: string;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-cyan-200/10 bg-white/[0.02] p-3.5">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] text-cyan-200">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-cyan-50">
          {title}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-400">
          {body}
        </span>
      </span>
    </li>
  );
}

function IssueNotice({
  issue,
}: {
  readonly issue: SignInIssue;
}): React.ReactElement {
  const isSuccess = issue.tone === "success";

  return (
    <div
      role={isSuccess ? "status" : "alert"}
      className={`mt-5 rounded-xl border px-4 py-3 ${
        isSuccess
          ? "border-lime-300/25 bg-lime-300/[0.06]"
          : "border-amber-300/25 bg-amber-300/[0.06]"
      }`}
    >
      <p
        className={`font-mono text-[0.62rem] font-semibold uppercase tracking-[0.16em] ${
          isSuccess ? "text-lime-200" : "text-amber-200"
        }`}
      >
        {issue.badge}
      </p>
      <p className="mt-1.5 text-sm font-semibold text-cyan-50">{issue.title}</p>
      <p className="mt-1 text-xs leading-5 text-slate-300">{issue.body}</p>
      {issue.nextStep ? (
        <p className="mt-2 border-t border-white/10 pt-2 text-[0.7rem] leading-5 text-slate-400">
          {issue.nextStep}
        </p>
      ) : null}
    </div>
  );
}

function readParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function readSafeCallbackUrl(value: string | null): string {
  if (!value) return "/dashboard";

  if (value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  try {
    const parsed = new URL(value);
    if (parsed.origin === process.env.NEXTAUTH_URL) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return "/dashboard";
  }

  return "/dashboard";
}
