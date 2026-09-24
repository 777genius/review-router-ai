import type { Metadata } from "next";
import Link from "next/link";
import { Github, Gitlab, ShieldCheck } from "lucide-react";
import { Badge, Card } from "@reviewrouter/ui";
import {
  GitHubSignInButton,
  GitLabSignInButton,
} from "../../github-sign-in-button";
import { LogoMark } from "../../logo-mark";
import { createNoIndexPageMetadata } from "../../seo";
import {
  isGitHubAuthConfigured,
  isGitLabAuthConfigured,
} from "../../../src/auth/auth-env";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createNoIndexPageMetadata({
  title: "Sign in",
  description:
    "Sign in to connect source repository metadata to the ReviewRouter dashboard.",
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
    body: "GitHub returned from the App installation before dashboard sign-in was started. Continue below with GitHub or GitLab to connect source metadata to your dashboard.",
    nextStep:
      "If this repeats, disable “Request user authorization (OAuth) during installation” in the GitHub App settings and keep the setup URL pointed at /setup.",
    tone: "success",
  },
  OAuthSignin: {
    badge: "Sign-in issue",
    title: "Sign-in could not start.",
    body: "Check the source OAuth client settings, then try again.",
    tone: "warning",
  },
  AccessDenied: {
    badge: "Access denied",
    title: "The source provider denied access.",
    body: "Use an account that can access the selected workspace or repository.",
    tone: "warning",
  },
  Configuration: {
    badge: "Configuration issue",
    title: "ReviewRouter sign-in is not configured correctly.",
    body: "Contact support with this page URL.",
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
    <main className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-lg flex-col justify-center gap-5 px-4 py-10 sm:px-6">
      <section className="rounded-[2rem] border border-cyan-300/[0.12] bg-[var(--rr-surface-card-strong)] p-7 shadow-[0_24px_80px_rgba(0,0,0,0.42),0_0_90px_-54px_rgba(0,240,255,0.9)] backdrop-blur-2xl sm:p-10">
        <div className="flex items-center gap-3">
          <LogoMark size="sm" />
          <Badge tone={issue ? issue.tone : "accent"}>Source sign-in</Badge>
        </div>

        <h1 className="mt-7 text-4xl font-extrabold leading-[1.12] tracking-[-0.04em] text-[var(--rr-color-text)] text-pretty sm:text-5xl">
          Sign in to <span className="whitespace-nowrap">ReviewRouter</span>
        </h1>
        <p className="mt-4 text-base leading-7 text-[var(--rr-color-text-muted)] text-pretty">
          Continue with GitHub or GitLab to map repository metadata to your
          dashboard. Provider credentials and PR diffs stay in your CI boundary.
        </p>

        <div className="mt-8 grid gap-3">
          <GitHubSignInButton
            callbackUrl={callbackUrl}
            size="lg"
            className="w-full rounded-2xl"
            disabled={!githubConfigured}
          >
            <span className="inline-flex items-center justify-center gap-2">
              <Github className="h-5 w-5" aria-hidden="true" />
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
                <Gitlab className="h-5 w-5" aria-hidden="true" />
                Continue with GitLab
              </span>
            </GitLabSignInButton>
          ) : null}
        </div>

        <p className="mt-6 text-center text-sm text-[var(--rr-color-text-muted)]">
          <Link
            href="/"
            className="underline-offset-4 transition hover:text-[var(--rr-color-text)] hover:underline"
          >
            Back to home
          </Link>
        </p>
      </section>

      {issue ? (
        <Card className="rounded-2xl border-amber-300/20 bg-amber-300/[0.05] p-5 sm:p-6">
          <Badge tone={issue.tone}>{issue.badge}</Badge>
          <h2 className="mt-4 text-2xl font-semibold text-[var(--rr-color-text)]">
            {issue.title}
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--rr-color-text-muted)]">
            {issue.body}
          </p>
          {issue.nextStep ? (
            <p className="mt-3 text-xs leading-5 text-[var(--rr-color-text-muted)]">
              {issue.nextStep}
            </p>
          ) : null}
        </Card>
      ) : (
        <Card className="rounded-2xl p-5 sm:p-6">
          <Badge tone="success">No secrets stored here</Badge>
          <h2 className="mt-4 flex items-center gap-2 text-xl font-semibold text-[var(--rr-color-text)]">
            <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
            Sign-in only connects metadata.
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--rr-color-text-muted)]">
            ReviewRouter uses source identity to show repositories, setup
            status, and health. It does not ask for Codex OAuth files or
            provider API keys here.
          </p>
        </Card>
      )}
    </main>
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
