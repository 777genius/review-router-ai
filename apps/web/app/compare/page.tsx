import type { Metadata } from "next";
import { BookOpen, ShieldCheck } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  LinkButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@reviewrouter/ui";
import { createPublicPageMetadata } from "../seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "ReviewRouter vs AI code review apps",
  description:
    "Compare ReviewRouter with CodeRabbit, Qodo, Greptile, GitHub Copilot Code Review, Cursor Bugbot, Claude Code Review and Graphite Agent: where reviews run, supported platforms and self-hosting.",
  path: "/compare",
});

const checkedOn = "November 16, 2026";

type Product = {
  readonly name: string;
  readonly icon: string;
  readonly invertIcon?: true;
  readonly runs: string;
  readonly platforms: string;
  readonly selfHost: string;
  readonly bestFit: string;
  readonly accent?: true;
};

const products: readonly Product[] = [
  {
    name: "ReviewRouter",
    icon: "/review-router-logo.png",
    runs: "Your GitHub Actions, with a hosted or self-hosted dashboard",
    platforms: "GitHub (GitLab in development)",
    selfHost: "Guided Docker Compose installer",
    bestFit:
      "Teams that want reviews to run in their own CI with their own AI account",
    accent: true,
  },
  {
    name: "CodeRabbit",
    icon: "/service-icons/coderabbit.svg",
    runs: "CodeRabbit cloud, or self-hosted on Enterprise",
    platforms: "GitHub, GitLab, Bitbucket, Azure DevOps",
    selfHost:
      "Enterprise with 500 or more seats; prompts and code still go to your configured LLM provider",
    bestFit: "Fast setup across many code hosts",
  },
  {
    name: "Qodo",
    icon: "/service-icons/qodo.svg",
    runs: "Multi-tenant cloud, single-tenant, on-prem or air-gapped",
    platforms: "GitHub, GitLab, Bitbucket, Azure DevOps Cloud, Gerrit",
    selfHost:
      "On-prem and air-gapped; the open-source PR-Agent is a separate community project",
    bestFit: "Managed review with governance and deployment options",
  },
  {
    name: "Greptile",
    icon: "/service-icons/greptile.svg",
    runs: "Greptile cloud or self-hosted",
    platforms: "GitHub, GitLab, Bitbucket and others",
    selfHost:
      "Docker Compose or Kubernetes with a license; docs describe air-gapped use with OpenAI-compatible models",
    bestFit: "Deep context from a full-repository index",
  },
  {
    name: "GitHub Copilot Code Review",
    icon: "/service-icons/github-copilot.svg",
    invertIcon: true,
    runs: "GitHub Actions: GitHub-hosted runners by default, self-hosted optional",
    platforms: "GitHub, and Azure Repos in public preview",
    selfHost: "Self-hosted runners on GitHub; not supported for Azure Repos",
    bestFit: "Teams already on GitHub and Copilot",
  },
  {
    name: "Cursor Bugbot",
    icon: "/service-icons/cursor.svg",
    invertIcon: true,
    runs: "Cursor cloud",
    platforms:
      "GitHub, GitLab, Bitbucket and Azure DevOps Services (some in beta)",
    selfHost: "No self-hosting",
    bestFit: "Teams already using Cursor",
  },
  {
    name: "Claude Code Review",
    icon: "/service-icons/claude.svg",
    runs: "Anthropic infrastructure (Team and Enterprise), or your own CI runners",
    platforms: "GitHub including GHES for the managed review",
    selfHost:
      "Managed review does not run self-hosted; the GitHub Action and GitLab CI/CD run on your runners",
    bestFit: "Claude-heavy teams that can choose managed or self-run",
  },
  {
    name: "Graphite Agent",
    icon: "/service-icons/graphite.svg",
    invertIcon: true,
    runs: "Graphite cloud",
    platforms: "GitHub; GitHub Enterprise Server on Enterprise",
    selfHost: "No self-hosted Graphite service",
    bestFit: "Stacked-PR and merge-queue teams on GitHub",
  },
];

const boundaryColumns = [
  "Typical SaaS",
  "Enterprise self-host",
  "ReviewRouter",
] as const;

const boundaryRows: readonly {
  readonly label: string;
  readonly values: readonly [string, string, string];
}[] = [
  {
    label: "Dashboard and settings",
    values: ["Vendor cloud", "Your servers", "Hosted by us, or self-hosted"],
  },
  {
    label: "Where reviews run",
    values: ["Vendor cloud", "Your servers", "Your GitHub Actions"],
  },
  {
    label: "Who receives review context",
    values: [
      "The vendor and its model providers",
      "The model provider you configure",
      "The AI provider you choose",
    ],
  },
  {
    label: "Provider credentials",
    values: [
      "Vendor or you",
      "You",
      "Your GitHub Actions secrets, or Gateway custody",
    ],
  },
];

const sources = [
  ["CodeRabbit", "https://docs.coderabbit.ai/self-hosted/overview"],
  ["Qodo", "https://docs.qodo.ai/deployment-models"],
  ["Greptile", "https://www.greptile.com/docs/self-hosting/overview"],
  [
    "GitHub Copilot Code Review",
    "https://docs.github.com/en/copilot/concepts/agents/code-review",
  ],
  ["Cursor Bugbot", "https://cursor.com/docs/bugbot"],
  ["Claude Code Review", "https://code.claude.com/docs/en/code-review"],
  ["Graphite", "https://graphite.com/docs/github-enterprise-server"],
] as const;

const th =
  "px-4 py-3 text-left font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400";
const td = "px-4 py-4 align-top text-sm leading-6";

export default function ComparePage(): React.ReactElement {
  return (
    <main className="home-shell min-h-screen w-full overflow-clip py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-6xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-3xl">
          <Badge tone="accent">Comparison</Badge>
          <h1 className="mt-6 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            ReviewRouter vs AI code review apps
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            See where each reviewer runs, which code hosts it supports and
            whether you can self-host it. ReviewRouter is a hosted dashboard
            whose reviews run inside your GitHub Actions.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/security" variant="soft" tone="success">
              <ShieldCheck aria-hidden="true" className="size-5" />
              Security model
            </LinkButton>
            <LinkButton href="/getting-started" variant="outline">
              <BookOpen aria-hidden="true" className="size-5" />
              Setup guide
            </LinkButton>
          </div>
        </header>

        <section className="mt-14" aria-labelledby="compare-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2
              id="compare-title"
              className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
            >
              How they differ
            </h2>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-slate-500">
              Checked {checkedOn}
            </p>
          </div>
          <Tabs defaultValue="matrix" className="mt-6">
            <TabsList aria-label="Comparison view">
              <TabsTrigger value="matrix">Product matrix</TabsTrigger>
              <TabsTrigger value="ownership">Who owns what</TabsTrigger>
            </TabsList>

            <TabsContent value="matrix" keepMounted>
              <div className="overflow-x-auto rounded-2xl border border-cyan-200/12 bg-[var(--rr-surface-panel)]">
                <table className="w-full min-w-[920px] border-collapse">
                  <thead>
                    <tr className="border-b border-cyan-200/12">
                      <th className={th}>Product</th>
                      <th className={th}>Where reviews run</th>
                      <th className={th}>Code hosts</th>
                      <th className={th}>Self-hosting</th>
                      <th className={th}>Best fit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {products.map((product) => (
                      <tr
                        key={product.name}
                        className={
                          product.accent ? "bg-lime-300/[0.045]" : undefined
                        }
                      >
                        <th scope="row" className={`${td} text-left`}>
                          <span className="flex items-center gap-3 font-semibold text-cyan-50">
                            <img
                              src={product.icon}
                              alt=""
                              className={`size-6 shrink-0 object-contain ${
                                product.invertIcon ? "invert" : ""
                              }`}
                            />
                            {product.name}
                          </span>
                        </th>
                        <td className={`${td} text-slate-300`}>
                          {product.runs}
                        </td>
                        <td className={`${td} text-slate-400`}>
                          {product.platforms}
                        </td>
                        <td className={`${td} text-slate-400`}>
                          {product.selfHost}
                        </td>
                        <td className={`${td} text-slate-400`}>
                          {product.bestFit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-slate-500">
                <ShieldCheck
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-cyan-300"
                />
                Information reflects public vendor documentation checked on{" "}
                {checkedOn}. Vendors change plans and platforms often, so
                confirm compliance details before buying.
              </p>
            </TabsContent>

            <TabsContent value="ownership" keepMounted>
              <div className="overflow-x-auto rounded-2xl border border-cyan-200/12 bg-[var(--rr-surface-panel)]">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr className="border-b border-cyan-200/12">
                      <th className={th}>
                        <span className="sr-only">Topic</span>
                      </th>
                      {boundaryColumns.map((column) => (
                        <th
                          key={column}
                          className={`${th} ${
                            column === "ReviewRouter" ? "text-lime-300" : ""
                          }`}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {boundaryRows.map((row) => (
                      <tr key={row.label}>
                        <th
                          scope="row"
                          className={`${td} text-left font-semibold text-cyan-50`}
                        >
                          {row.label}
                        </th>
                        {row.values.map((value, index) => (
                          <td
                            key={boundaryColumns[index]}
                            className={`${td} ${
                              index === 2
                                ? "bg-lime-300/[0.045] text-lime-100"
                                : "text-slate-400"
                            }`}
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                Self-hosting a reviewer does not by itself stop code from
                reaching a model provider: CodeRabbit&apos;s documentation, for
                example, says prompts and source code go to the LLM provider you
                configure. In ReviewRouter, the AI provider you choose receives
                the review context.
              </p>
            </TabsContent>
          </Tabs>
        </section>

        <section className="mt-16" aria-labelledby="sources-title">
          <h2
            id="sources-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Sources
          </h2>
          <Accordion className="mt-6">
            <AccordionItem value="sources">
              <AccordionTrigger>
                Vendor documentation we checked
              </AccordionTrigger>
              <AccordionContent>
                <ul className="space-y-2">
                  {sources.map(([name, href]) => (
                    <li key={name}>
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-cyan-200 hover:text-cyan-50"
                      >
                        {name}
                      </a>
                      <span className="ml-2 font-mono text-xs text-slate-500">
                        {href}
                      </span>
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-cyan-200/10 pt-8">
          <p className="text-lg font-semibold text-cyan-50">
            Keep your code in your own CI.
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/security" variant="soft" tone="success">
              Security model
            </LinkButton>
            <LinkButton href="/getting-started" variant="outline">
              Setup guide
            </LinkButton>
          </div>
        </div>
      </div>
    </main>
  );
}
