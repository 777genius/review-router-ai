import type { Metadata } from "next";
import {
  ArrowRight,
  Cloud,
  GitPullRequestArrow,
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

const anthropicCommand = `gh secret set ANTHROPIC_API_KEY --repo owner/repo --app actions`;
const openRouterCommand = `gh secret set OPENROUTER_API_KEY --repo owner/repo --app actions`;
const mimoTokenPlanCommand = `gh secret set MIMO_TOKEN_PLAN_API_KEY --repo owner/repo --app actions`;
const kimiCodeCommand = `gh secret set KIMI_CODE_API_KEY --repo owner/repo --app actions`;

const selfHostCommand = `SOURCE_SHA=PASTE_APPROVED_40_CHARACTER_COMMIT_SHA
git clone ${reviewRouterSourceCodeUrl}.git reviewrouter
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

type ConnectOption = {
  readonly title: string;
  readonly where: "GitHub secret" | "Gateway account" | "Hosted pool";
  readonly body: string;
  readonly secret?: string;
  readonly code?: string;
};

type ProviderGuide = {
  readonly value: string;
  readonly id: ProviderIdentity;
  readonly name: string;
  readonly summary: string;
  readonly facts: readonly (readonly [string, string])[];
  readonly options: readonly ConnectOption[];
};

// Mirrors the provider catalog (packages/features/review-providers) and the
// dashboard setup providers: default models, auth modes and secret names.
const providerGuides: readonly ProviderGuide[] = [
  {
    value: "codex",
    id: "openai",
    name: "Codex",
    summary: "Use your Codex subscription for reviews.",
    facts: [
      ["Default model", "gpt-5.6-sol"],
      ["Settings", "Reasoning effort, fast mode"],
    ],
    options: [
      {
        title: "Repository sign-in (default)",
        where: "GitHub secret",
        body: "Use the command the dashboard generates for the selected repository. Generic Codex commands are intentionally not offered.",
        secret: "Server-issued versioned namespace",
        code: codexRepoCommand,
      },
      {
        title: "Hosted account pool",
        where: "Hosted pool",
        body: "Where the hosted pool is enabled, a workspace account pool serves the review and GitHub Actions only receives a grant bounded to that one invocation, so no Codex credential lives in the repository.",
      },
      {
        title: "Gateway account",
        where: "Gateway account",
        body: "Dashboard, Providers, Add account, then Connect Codex OAuth. One managed connection can be shared with several workspaces.",
      },
    ],
  },
  {
    value: "claude",
    id: "anthropic",
    name: "Claude Code",
    summary: "Use a Claude Code subscription or an Anthropic API key.",
    facts: [["Default model", "sonnet"]],
    options: [
      {
        title: "Subscription token",
        where: "GitHub secret",
        body: "Store only the token that claude setup-token prints. Do not paste local Claude config files.",
        secret: "CLAUDE_CODE_OAUTH_TOKEN",
        code: claudeCommand,
      },
      {
        title: "Anthropic API key",
        where: "GitHub secret",
        body: "Use normal Anthropic API billing instead of a subscription.",
        secret: "ANTHROPIC_API_KEY",
        code: anthropicCommand,
      },
    ],
  },
  {
    value: "mimo",
    id: "mimo",
    name: "MiMo Token Plan",
    summary: "Bring your MiMo Token Plan API key.",
    facts: [
      ["Default model", "mimo-v2.6-pro"],
      ["Settings", "Reasoning effort, fast mode"],
    ],
    options: [
      {
        title: "API key in GitHub",
        where: "GitHub secret",
        body: "gh asks for the key at its own secret prompt, so the key never appears in the command line.",
        secret: "MIMO_TOKEN_PLAN_API_KEY",
        code: mimoTokenPlanCommand,
      },
      {
        title: "API key as a Gateway account",
        where: "Gateway account",
        body: "Dashboard, Providers, Add account, then Connect with API key. The key stays in protected Gateway custody instead of GitHub.",
      },
    ],
  },
  {
    value: "openrouter",
    id: "openrouter",
    name: "OpenRouter",
    summary: "Route reviews through any model your OpenRouter key can use.",
    facts: [
      ["Default model", "openai/gpt-5.3-codex"],
      ["Models", "Loaded from the OpenRouter catalog"],
    ],
    options: [
      {
        title: "API key in GitHub",
        where: "GitHub secret",
        body: "Normal OpenRouter billing applies when you prefer an API key over a subscription.",
        secret: "OPENROUTER_API_KEY",
        code: openRouterCommand,
      },
      {
        title: "API key as a Gateway account",
        where: "Gateway account",
        body: "Dashboard, Providers, Add account, then Connect with API key.",
      },
    ],
  },
  {
    value: "kimi",
    id: "kimi",
    name: "Kimi Code",
    summary: "Bring your Kimi Code API key.",
    facts: [["Default model", "k3-256k"]],
    options: [
      {
        title: "API key in GitHub",
        where: "GitHub secret",
        body: "Store the Kimi Code API key as a GitHub Actions secret for the repository.",
        secret: "KIMI_CODE_API_KEY",
        code: kimiCodeCommand,
      },
      {
        title: "API key as a Gateway account",
        where: "Gateway account",
        body: "Dashboard, Providers, Add account, then Connect with API key.",
      },
    ],
  },
  {
    value: "more",
    id: "nvidia",
    name: "More providers",
    summary:
      "These providers connect only as managed Gateway accounts: the key is kept in protected Gateway custody and never becomes a GitHub secret.",
    facts: [["Where", "Dashboard, Providers, Add account"]],
    options: [
      {
        title: "NVIDIA Build",
        where: "Gateway account",
        body: "Connect an NVIDIA Build API key.",
      },
      {
        title: "GLM Coding Plan",
        where: "Gateway account",
        body: "Connect a GLM Coding Plan key.",
      },
      {
        title: "MiniMax M Plan",
        where: "Gateway account",
        body: "Connect a MiniMax M Plan key.",
      },
      {
        title: "Grok",
        where: "Gateway account",
        body: "Connect a Grok subscription.",
      },
    ],
  },
];

const boundaries = [
  {
    icon: Terminal,
    title: "Code runs in your CI",
    body: "Checkout and tools run in GitHub Actions. ReviewRouter stores results and operational metadata, not raw source files.",
  },
  {
    icon: LockKeyhole,
    title: "Direct mode keeps secrets in CI",
    body: "With direct provider setup, credentials live in GitHub Actions secrets that you set from your own machine. Gateway connections use protected server custody instead.",
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
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Two choices: which provider, and where its credential lives. A
            GitHub secret keeps it in your repository&apos;s Actions; a managed
            Gateway account keeps it in protected server custody and can be
            shared across workspaces. Run the commands from your own machine;
            secret values go directly into GitHub Actions secrets.
          </p>
          <Tabs defaultValue="codex" className="mt-6">
            <TabsList aria-label="AI provider">
              {providerGuides.map((guide) => (
                <TabsTrigger key={guide.value} value={guide.value}>
                  <ProviderMark providerId={guide.id} />
                  {guide.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {providerGuides.map((guide) => (
              <TabsContent key={guide.value} value={guide.value} keepMounted>
                <p className="max-w-3xl text-sm leading-6 text-slate-300">
                  {guide.summary}
                </p>
                <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-xs">
                  {guide.facts.map(([label, value]) => (
                    <div key={label} className="flex gap-2">
                      <dt className="font-mono uppercase tracking-[0.14em] text-slate-500">
                        {label}
                      </dt>
                      <dd className="font-mono text-cyan-100">{value}</dd>
                    </div>
                  ))}
                </dl>
                <ol className="mt-5 divide-y divide-cyan-200/10 border-y border-cyan-200/10">
                  {guide.options.map((option) => (
                    <li key={option.title} className="py-5">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-base font-semibold text-cyan-50">
                          {option.title}
                        </h3>
                        <Badge
                          size="xs"
                          tone={
                            option.where === "GitHub secret"
                              ? "accent"
                              : "neutral"
                          }
                        >
                          {option.where}
                        </Badge>
                      </div>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                        {option.body}
                      </p>
                      {option.secret ? (
                        <p className="mt-2 font-mono text-xs text-cyan-100">
                          {option.secret}
                        </p>
                      ) : null}
                      {option.code ? (
                        <div className="mt-3">
                          <CodeBlock code={option.code} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </TabsContent>
            ))}
          </Tabs>
          <p className="mt-5 max-w-3xl text-xs leading-5 text-slate-500">
            After connecting, choose models, reasoning effort and other review
            settings per workspace or repository in the dashboard. Gateway
            credentials are kept in protected server custody; see the{" "}
            <a
              href="/security"
              className="font-semibold text-cyan-200 hover:text-cyan-50"
            >
              security model
            </a>{" "}
            for the difference.
          </p>
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
          aria-labelledby="code-hosts-title"
        >
          <h2
            id="code-hosts-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Supported code hosts
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            ReviewRouter works with GitHub today. GitLab support is in
            development and is not available yet.
          </p>
        </section>

        <section className="mt-16" aria-labelledby="troubleshooting-title">
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
