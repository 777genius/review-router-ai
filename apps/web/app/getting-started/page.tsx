import type { Metadata } from "next";
import {
  ArrowRight,
  Cloud,
  GitPullRequestArrow,
  KeyRound,
  LockKeyhole,
  Server,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  CodeBlock,
  LinkButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reviewrouter/ui";
import { ProviderMark } from "../dashboard/provider-logo";
import { reviewRouterSourceCodeUrl } from "../public-urls";
import { createPublicPageMetadata } from "../seo";
import type { ProviderIdentity } from "../../src/features/provider-setup/provider-identity";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Getting started with ReviewRouter",
  description:
    "Install the ReviewRouter GitHub App, merge the setup PR, connect Codex, Claude Code, MiMo Token Plan, OpenRouter or Kimi Code, and open a pull request. Or self-host ReviewRouter with the guided installer.",
  path: "/getting-started",
});

const selfHostGuideUrl = `${reviewRouterSourceCodeUrl}/blob/main/docs/operations/review-router-self-hosted-end-to-end.md`;

const codexRepoCommand = `# Open Dashboard -> Enable review -> Codex for the repository.
# Copy and run the complete command generated there.
# It downloads an immutable installer to a temporary file, verifies its SHA-256,
# and only then executes it with a short-lived, repository-scoped setup nonce.`;

const claudeCommand = `claude setup-token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo owner/repo --app actions`;

const openRouterCommand = `gh secret set OPENROUTER_API_KEY --repo owner/repo --app actions`;
const mimoTokenPlanCommand = `gh secret set MIMO_TOKEN_PLAN_API_KEY --repo owner/repo --app actions`;
const kimiCodeCommand = `gh secret set KIMI_CODE_API_KEY --repo owner/repo --app actions`;

const selfHostCommand = `SOURCE_SHA=PASTE_APPROVED_40_CHARACTER_COMMIT_SHA
git clone https://github.com/777genius/review-router-ai.git reviewrouter
git -C reviewrouter fetch origin "$SOURCE_SHA"
git -C reviewrouter checkout --detach "$SOURCE_SHA"
cd reviewrouter
bash scripts/install-self-hosted.sh \\
  --web-url https://review.example.com \\
  --api-url https://api.review.example.com \\
  --repo OWNER/REPOSITORY`;

const hostedSteps = [
  {
    title: "Install the GitHub App",
    body: "Install ReviewRouter on the repositories you choose, or request approval from your organization owner. The dashboard then lists those repositories.",
  },
  {
    title: "Create and merge the setup PR",
    body: "Create the setup PR from the dashboard. It adds the ReviewRouter workflow files on the reviewrouter/setup branch for you to inspect. Merge it so your default branch owns the workflow.",
  },
  {
    title: "Connect an AI provider",
    body: "Pick Codex, Claude Code, MiMo Token Plan, OpenRouter or Kimi Code in the dashboard. Provider usage is billed to your own subscription or API account.",
  },
  {
    title: "Open a pull request",
    body: "The review runs in GitHub Actions and posts inline findings with a summary. With the Interaction workflow installed, comment /rr help, /rr status or /rr review on the PR.",
  },
] as const;

const selfHostChecklist = [
  "A Linux x64 server with Docker Compose v2, Git, curl and Node.js 24.21+ or 26.10+.",
  "Two public DNS names for the web app and the API, with ports 80 and 443 open for automatic HTTPS.",
  "A GitHub account that can create and install an App, and an AI provider account.",
] as const;

const providers: readonly {
  readonly id: ProviderIdentity;
  readonly name: string;
  readonly auth: string;
  readonly secret: string;
}[] = [
  {
    id: "openai",
    name: "Codex",
    auth: "Subscription sign-in",
    secret: "Server-issued versioned namespace",
  },
  {
    id: "anthropic",
    name: "Claude Code",
    auth: "OAuth token",
    secret: "CLAUDE_CODE_OAUTH_TOKEN",
  },
  {
    id: "mimo",
    name: "MiMo Token Plan",
    auth: "API key",
    secret: "MIMO_TOKEN_PLAN_API_KEY",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    auth: "API key",
    secret: "OPENROUTER_API_KEY",
  },
  {
    id: "kimi",
    name: "Kimi Code",
    auth: "API key",
    secret: "KIMI_CODE_API_KEY",
  },
];

const credentialCommands = [
  {
    value: "codex",
    title: "Codex, one repository at a time",
    body: "Use the command the dashboard generates for the selected repository. Generic Codex commands are intentionally not offered.",
    code: codexRepoCommand,
  },
  {
    value: "claude",
    title: "Claude Code",
    body: "Store only the token that claude setup-token prints. Do not paste local Claude config files.",
    code: claudeCommand,
  },
  {
    value: "mimo",
    title: "MiMo Token Plan",
    body: "gh asks for the key at its own secret prompt, so the key never appears in the command line.",
    code: mimoTokenPlanCommand,
  },
  {
    value: "openrouter",
    title: "OpenRouter",
    body: "Normal OpenRouter billing applies when you prefer an API key over a subscription.",
    code: openRouterCommand,
  },
  {
    value: "kimi",
    title: "Kimi Code",
    body: "Store the Kimi Code API key as a GitHub Actions secret for the repository.",
    code: kimiCodeCommand,
  },
] as const;

const boundaries = [
  {
    icon: Terminal,
    title: "Code runs in your CI",
    body: "Checkout and tools run in GitHub Actions. ReviewRouter stores results and operational metadata, not raw source files.",
  },
  {
    icon: LockKeyhole,
    title: "Credentials stay in CI",
    body: "Repository credentials stay in GitHub Actions. You set provider secrets from your own machine.",
  },
  {
    icon: ShieldCheck,
    title: "Forks are skipped",
    body: "Secret-backed review does not run on fork pull requests, so provider secrets are not exposed to them.",
  },
  {
    icon: Cloud,
    title: "The provider sees review context",
    body: "The AI provider you choose receives the review context for the pull request it reviews.",
  },
] as const;

const troubleshooting = [
  {
    value: "ready",
    question: "What does Ready mean in the dashboard?",
    answer:
      "Ready means the workflow on your default branch is current and the provider is confirmed. A running self-hosted server alone is not proof of a completed review.",
  },
  {
    value: "setup-pr",
    question: "The setup PR was closed or its branch was deleted.",
    answer:
      "Create the setup PR again from the dashboard and merge the new one before you connect the provider again.",
  },
  {
    value: "no-review",
    question: "A pull request got no review.",
    answer:
      "Fork pull requests are skipped because provider secrets are not exposed to them. Otherwise check that the setup PR is merged and that the provider shows as confirmed for the repository.",
  },
  {
    value: "gitlab",
    question: "Does ReviewRouter work with GitLab?",
    answer: "GitLab support is in development and is not available yet.",
  },
] as const;

export default function GettingStartedPage(): React.ReactElement {
  return (
    <main className="home-shell min-h-screen w-full overflow-clip py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-3xl">
          <Badge tone="accent">Getting started</Badge>
          <h1 className="mt-6 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            From install to your first review in four steps.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Install the GitHub App, merge the setup PR, connect an AI provider
            and open a pull request. You approve every workflow change before
            reviews begin.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/dashboard" variant="soft" tone="success">
              <GitPullRequestArrow aria-hidden="true" className="size-5" />
              Open dashboard
            </LinkButton>
            <LinkButton href="/security" variant="outline">
              <ShieldCheck aria-hidden="true" className="size-5" />
              Security model
            </LinkButton>
          </div>
        </header>

        <section className="mt-14" aria-labelledby="setup-title">
          <h2
            id="setup-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Choose how to run ReviewRouter
          </h2>
          <Tabs defaultValue="hosted" className="mt-6">
            <TabsList aria-label="Hosting option">
              <TabsTrigger value="hosted">
                <Cloud aria-hidden="true" />
                Hosted
              </TabsTrigger>
              <TabsTrigger value="self-hosted">
                <Server aria-hidden="true" />
                Self-hosted
              </TabsTrigger>
            </TabsList>

            <TabsContent value="hosted" keepMounted>
              <ol className="divide-y divide-cyan-200/10 border-y border-cyan-200/10">
                {hostedSteps.map((step, index) => (
                  <li
                    key={step.title}
                    className="grid gap-3 py-5 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-6"
                  >
                    <span className="font-mono text-sm font-semibold tracking-[0.14em] text-cyan-300">
                      Step {index + 1}
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-cyan-50">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </TabsContent>

            <TabsContent value="self-hosted" keepMounted>
              <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                <div>
                  <h3 className="text-lg font-semibold text-cyan-50">
                    Before you start
                  </h3>
                  <ul className="mt-3 space-y-3 text-sm leading-6 text-slate-400">
                    {selfHostChecklist.map((item) => (
                      <li key={item} className="flex gap-3">
                        <span
                          aria-hidden="true"
                          className="mt-2 size-1.5 shrink-0 rounded-full bg-lime-300"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-5 text-sm leading-6 text-slate-400">
                    You still approve the GitHub App, connect the provider
                    through GitHub Secrets and approve the workflow setup PR.
                  </p>
                  <a
                    href={selfHostGuideUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-cyan-50"
                  >
                    Read the self-hosting guide
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </a>
                </div>
                <div>
                  <h3 className="mb-3 text-lg font-semibold text-cyan-50">
                    Run the guided installer
                  </h3>
                  <CodeBlock code={selfHostCommand} />
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Replace the example domains, repository and commit. Pinning
                    an approved source commit keeps the installation
                    reproducible; the guide also describes an agent-first
                    command for quick evaluations.
                  </p>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <section
          id="codex-oauth-rotating"
          className="mt-16"
          aria-labelledby="providers-title"
        >
          <h2
            id="providers-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Connect an AI provider
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Pick one provider first. You can change models, reasoning effort and
            other review settings later in the dashboard.
          </p>
          <ul className="mt-6 divide-y divide-cyan-200/10 border-y border-cyan-200/10">
            {providers.map((provider) => (
              <li
                key={provider.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 py-4 sm:grid-cols-[auto_12rem_10rem_minmax(0,1fr)]"
              >
                <span className="grid size-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08]">
                  <ProviderMark providerId={provider.id} />
                </span>
                <span className="font-semibold text-cyan-50">
                  {provider.name}
                </span>
                <span className="col-start-2 text-sm text-slate-400 sm:col-start-auto">
                  {provider.auth}
                </span>
                <span className="col-start-2 font-mono text-xs text-cyan-100 sm:col-start-auto">
                  {provider.secret}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16" aria-labelledby="commands-title">
          <div className="flex items-start gap-3">
            <KeyRound
              aria-hidden="true"
              className="mt-1.5 size-5 shrink-0 text-cyan-300"
            />
            <div>
              <h2
                id="commands-title"
                className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
              >
                Credential commands
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Run these from your own machine. Secret values go directly into
                GitHub Actions secrets.
              </p>
            </div>
          </div>
          <Accordion className="mt-6" defaultValue={["codex"]}>
            {credentialCommands.map((item) => (
              <AccordionItem key={item.value} value={item.value}>
                <AccordionTrigger>{item.title}</AccordionTrigger>
                <AccordionContent>
                  <p className="mb-4 max-w-2xl leading-6">{item.body}</p>
                  <CodeBlock code={item.code} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <section className="mt-16" aria-labelledby="boundary-title">
          <h2
            id="boundary-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            What stays where
          </h2>
          <dl className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {boundaries.map((item) => (
              <div key={item.title} className="flex gap-4">
                <item.icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-cyan-300"
                />
                <div>
                  <dt className="font-semibold text-cyan-50">{item.title}</dt>
                  <dd className="mt-1 text-sm leading-6 text-slate-400">
                    {item.body}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section
          id="gitlab"
          className="mt-16"
          aria-labelledby="troubleshooting-title"
        >
          <h2
            id="troubleshooting-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Troubleshooting
          </h2>
          <Accordion className="mt-6">
            {troubleshooting.map((item) => (
              <AccordionItem key={item.value} value={item.value}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>
                  <p className="max-w-2xl leading-6">{item.answer}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-cyan-200/10 pt-8">
          <p className="text-lg font-semibold text-cyan-50">
            Ready to review your first pull request?
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/dashboard" variant="soft" tone="success">
              Open dashboard
            </LinkButton>
            <LinkButton href="/compare" variant="outline">
              Compare
            </LinkButton>
          </div>
        </div>
      </div>
    </main>
  );
}
