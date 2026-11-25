import type { Metadata } from "next";
import { ArrowRight, Mail } from "lucide-react";
import { Badge, LinkButton } from "@reviewrouter/ui";
import {
  reviewRouterContactEmail,
  reviewRouterContactMailto,
  reviewRouterGitHubBugIssueUrl,
  reviewRouterGitHubSetupIssueUrl,
} from "../public-urls";
import { createPublicPageMetadata } from "../seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Support",
  description: `Email ${reviewRouterContactEmail} for help with ReviewRouter. What to include, where to report bugs and security issues, and what happens to what you send.`,
  path: "/support",
});

const securityReportMailto = `${reviewRouterContactMailto}?subject=${encodeURIComponent("Security report")}`;

const includeItems = [
  "Your GitHub login, or the workspace name shown in the dashboard.",
  "The repository, as owner/repo.",
  "A link to the pull request or the GitHub Actions run where it went wrong.",
  "What you expected to happen and what happened instead. If you saw an error, copy its text.",
] as const;

const leaveOutItems = [
  "API keys, OAuth or setup tokens, Codex auth.json files, GitHub tokens or GitHub App private keys.",
  "Private source code or full diffs. A link to the pull request is enough.",
] as const;

const docs = [
  {
    href: "/getting-started",
    title: "Getting started",
    body: "Installing the GitHub App, the setup PR and connecting a provider, plus fixes for a closed setup PR or a pull request that got no review.",
  },
  {
    href: "/security",
    title: "Security model",
    body: "What runs in your CI, what ReviewRouter stores, and why the GitHub App asks for each permission.",
  },
  {
    href: "/fair-use",
    title: "Fair use limits",
    body: "The limits on repository sync, setup PRs and config saves, in case one of them is blocking you.",
  },
  {
    href: "/disconnect",
    title: "Disconnect",
    body: "How to uninstall the GitHub App, remove workflow files and secrets, and ask for your data to be deleted.",
  },
] as const;

const sectionTitle = "text-2xl font-semibold text-cyan-50 sm:text-3xl";
const bodyText = "max-w-3xl text-sm leading-6 text-slate-400";
const textLink =
  "inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300/70";

function DotList({
  items,
  dotClassName,
}: {
  readonly items: readonly string[];
  readonly dotClassName: string;
}): React.ReactElement {
  return (
    <ul className="mt-4 max-w-3xl space-y-3 text-sm leading-6 text-slate-300">
      {items.map((item) => (
        <li key={item} className="flex gap-3">
          <span
            aria-hidden="true"
            className={`mt-2 size-1.5 shrink-0 rounded-full ${dotClassName}`}
          />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function SupportPage(): React.ReactElement {
  return (
    <main className="min-h-screen w-full py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-3xl">
          <Badge tone="accent">Support</Badge>
          <h1 className="mt-6 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            Get help with ReviewRouter
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Setup problems, questions and account requests all go to one email
            address. ReviewRouter is run by one person, so support is best
            effort and there is no promised response time.
          </p>
          <div className="mt-8">
            <LinkButton
              href={reviewRouterContactMailto}
              variant="soft"
              tone="success"
            >
              <Mail aria-hidden="true" className="size-5" />
              {reviewRouterContactEmail}
            </LinkButton>
          </div>
        </header>

        <section className="mt-14" aria-labelledby="support-include-title">
          <h2 id="support-include-title" className={sectionTitle}>
            What to put in your email
          </h2>
          <DotList items={includeItems} dotClassName="bg-lime-300" />

          <h3 className="mt-8 text-lg font-semibold text-cyan-50">
            Leave these out
          </h3>
          <DotList items={leaveOutItems} dotClassName="bg-red-300" />
          <p className={`mt-4 ${bodyText}`}>
            If a key or token may have leaked, revoke it with its provider
            first, then write.
          </p>
        </section>

        <section className="mt-16" aria-labelledby="support-docs-title">
          <h2 id="support-docs-title" className={sectionTitle}>
            Documentation
          </h2>
          <p className={`mt-2 ${bodyText}`}>
            These pages may answer your question before you write.
          </p>
          <ul className="mt-5 max-w-3xl divide-y divide-cyan-200/10 border-y border-cyan-200/10">
            {docs.map((doc) => (
              <li
                key={doc.href}
                className="grid gap-1 py-4 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-6"
              >
                <a href={doc.href} className={`${textLink} self-start`}>
                  {doc.title}
                </a>
                <p className="text-sm leading-6 text-slate-400 sm:py-2.5">
                  {doc.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="support-report-title">
          <h2 id="support-report-title" className={sectionTitle}>
            Bugs and security issues
          </h2>
          <p className={`mt-2 ${bodyText}`}>
            You can also report bugs and setup problems on GitHub, which has a
            template for each. Issues there are public, so stick to links and
            error text.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <LinkButton href={reviewRouterGitHubBugIssueUrl} variant="outline">
              Report a bug on GitHub
            </LinkButton>
            <LinkButton
              href={reviewRouterGitHubSetupIssueUrl}
              variant="outline"
            >
              Ask for setup help on GitHub
            </LinkButton>
          </div>
          <p className={`mt-8 ${bodyText}`}>
            Do not open a public issue for a security problem, such as a leaked
            credential, a way to see another workspace&apos;s data or a way
            around a permission check. Email it to {reviewRouterContactEmail}{" "}
            instead.
          </p>
          <a href={securityReportMailto} className={`mt-2 ${textLink}`}>
            Email a security report
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </section>

        <section className="mt-16" aria-labelledby="support-privacy-title">
          <h2 id="support-privacy-title" className={sectionTitle}>
            What happens to what you send
          </h2>
          <p className={`mt-2 ${bodyText}`}>
            Your email and anything in it are used to answer you and fix the
            problem. They are kept as long as support, security or legal reasons
            require, with no fixed deletion date. To have your account or
            workspace data deleted, email the same address; you may be asked to
            show that you are allowed to make the request.
          </p>
          <a href="/privacy" className={`mt-2 ${textLink}`}>
            Read the privacy policy
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </section>
      </div>
    </main>
  );
}
