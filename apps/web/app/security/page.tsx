import type { Metadata } from "next";
import {
  AlertTriangle,
  BookOpen,
  Code2,
  ExternalLink,
  KeyRound,
  Network,
  RadioTower,
  ShieldCheck,
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
import { resolveCodexSeedScriptUrl } from "@/server/codex-seed-script-url";
import { githubSecretPermissionDocs } from "../github-app-permission-doc-links";
import { createPublicPageMetadata } from "../seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Security model for AI code review",
  description:
    "ReviewRouter security model for privacy-first AI code review: GitHub App setup, GitHub Actions execution, OIDC runtime config, and secret boundaries.",
  path: "/security",
});

const secretCommand = `# Copy the full repo-scoped Codex command from the ReviewRouter dashboard.
# It uses ${resolveCodexSeedScriptUrl()} with a short-lived setup nonce and writes one server-issued versioned namespace directly to GitHub Actions secrets.`;

const securitySignals = [
  {
    icon: Code2,
    title: "Review execution runs in the authorized CI job.",
    body: "Submitted review context is sent to the selected model provider, through Account Gateway relay in Gateway mode. ReviewRouter stores review metadata and normalized findings, which may include source excerpts.",
  },
  {
    icon: KeyRound,
    title: "Credentials use protected mode-specific custody.",
    body: "Direct workflow credentials are installed in GitHub Actions. Account Gateway credentials use the supported server ingress and protected server custody; they are not exposed through account readback or copied into the review job. Enrollment handles plaintext transiently; stored credentials are encrypted at rest.",
  },
  {
    icon: AlertTriangle,
    title: "Secret-backed review is skipped for fork PRs by default.",
    body: "The generated workflow avoids automatically exposing secrets to untrusted fork code. Trusted rerun flows should be explicit maintainer actions.",
  },
  {
    icon: RadioTower,
    title: "OIDC avoids long-lived ReviewRouter API tokens in repos.",
    body: "GitHub Actions requests short-lived runtime config through OIDC. Production Codex OAuth rotating runs fail closed if the control plane cannot validate the run.",
  },
] as const;

const boundaryRows = [
  {
    layer: "Authorized review job",
    ownedBy: "Customer CI runtime",
    sensitiveData:
      "Repository checkout, review context, prompts, model output, scoped review grant",
    custody: "Customer",
  },
  {
    layer: "Provider credentials",
    ownedBy: "GitHub Actions or protected Account Gateway custody",
    sensitiveData:
      "Direct workflow credentials; Gateway credentials and transient enrollment data",
    custody: "Mode-specific",
  },
  {
    layer: "ReviewRouter SaaS",
    ownedBy: "ReviewRouter control plane",
    sensitiveData:
      "Setup metadata, policy, audit, health, and protected Account Gateway custody",
    custody: "ReviewRouter",
  },
] as const;

type PermissionRow = {
  readonly permission: string;
  readonly access: "Read" | "Write" | "Metadata";
  readonly reason: string;
  readonly docs?: readonly { readonly label: string; readonly href: string }[];
};

// Mirrors the "provisioning" permission profile used for hosted setup, plus
// organization_administration from the "org-ruleset" profile (org-wide checks).
const permissionRows: readonly PermissionRow[] = [
  {
    permission: "metadata: read",
    access: "Read",
    reason: "Discover repository identity and default branch.",
  },
  {
    permission: "actions: write",
    access: "Write",
    reason:
      "Dispatch exact-revision review runs and read their metadata for durable request tracking.",
  },
  {
    permission: "checks: write",
    access: "Write",
    reason:
      "Publish ReviewRouter-owned check runs when direct GitHub check integration is enabled.",
  },
  {
    permission: "contents: write",
    access: "Write",
    reason: "Create workflow setup branches and commits.",
  },
  {
    permission: "workflows: write",
    access: "Write",
    reason: "Open PRs that add or update the ReviewRouter workflow.",
  },
  {
    permission: "pull_requests: write",
    access: "Write",
    reason: "Create setup PRs and read setup PR state.",
  },
  {
    permission: "secrets: write",
    access: "Write",
    reason:
      "Verify required GitHub Actions secret metadata and write encrypted rotating Codex OAuth payloads after OIDC/writeback checks. GitHub does not expose decrypted secret values.",
    docs: [
      {
        label: "Repository secret docs",
        href: githubSecretPermissionDocs.repositorySecret,
      },
    ],
  },
  {
    permission: "organization_secrets: read",
    access: "Metadata",
    reason:
      "Verify org-level selected-repository secret metadata for organization-owned repos. ReviewRouter checks whether the current repository is allowed to use the secret.",
    docs: [
      {
        label: "Organization secret docs",
        href: githubSecretPermissionDocs.organizationSecret,
      },
      {
        label: "Selected repository docs",
        href: githubSecretPermissionDocs.organizationSecretRepositories,
      },
    ],
  },
  {
    permission: "organization_plan: read",
    access: "Read",
    reason:
      "Detect whether organization-level Actions secrets can be used for private repositories, so setup can recommend repository secrets when needed.",
  },
  {
    permission: "statuses: write",
    access: "Write",
    reason:
      "Publish ReviewRouter-owned commit statuses when direct GitHub status integration is enabled.",
  },
  {
    permission: "issues: write",
    access: "Write",
    reason:
      "Support setup/help comments and issue-style PR conversations. Review execution still runs from customer runtime.",
  },
  {
    permission: "organization_administration: write",
    access: "Write",
    reason:
      "Only for organization-wide checks: create and update the GitHub Ruleset that requires the shared workflow. Not needed for per-repository setup.",
  },
];

type WebhookRow = {
  readonly event: string;
  readonly handled: boolean;
  readonly use: string;
};

// Handled events mirror supportedGitHubInstallationWebhookEvents. The App is
// also subscribed to the others, but the webhook endpoint acknowledges and
// ignores them.
const webhookRows: readonly WebhookRow[] = [
  {
    event: "installation",
    handled: true,
    use: "Create, suspend, unsuspend, and uninstall lifecycle events for workspace and installation state.",
  },
  {
    event: "installation_repositories",
    handled: true,
    use: "Repository added/removed events so selected-repository installs stay in sync without manual refresh.",
  },
  {
    event: "pull_request",
    handled: true,
    use: "Detect when setup PRs are merged and advance repository setup state automatically.",
  },
  {
    event: "push",
    handled: true,
    use: "Track the pushed ref and whether it was deleted, so setup state follows the default branch.",
  },
  {
    event: "repository",
    handled: true,
    use: "Refresh repository metadata such as rename, archived state, visibility, and default branch.",
  },
  {
    event: "github_app_authorization",
    handled: true,
    use: "Receive user authorization events for the GitHub App.",
  },
  {
    event: "issue_comment",
    handled: false,
    use: "/rr commands run through the Interaction workflow in your repository, not through this endpoint.",
  },
  {
    event: "workflow_job, workflow_run, check_run, status",
    handled: false,
    use: "Subscribed for run and status integrations; the endpoint acknowledges these deliveries without processing them.",
  },
];

const tableWrap =
  "overflow-x-auto rounded-2xl border border-cyan-200/12 bg-[var(--rr-surface-panel)]";
const th =
  "px-4 py-3 text-left font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400";
const td = "px-4 py-4 align-top";

export default function SecurityPage(): React.ReactElement {
  return (
    <main className="home-shell min-h-screen w-full overflow-clip py-10 md:py-14">
      <div className="mx-auto w-[calc(100%-2rem)] max-w-5xl sm:w-[calc(100%-3rem)]">
        <header className="max-w-3xl">
          <Badge tone="accent">Security model</Badge>
          <h1 className="mt-6 text-4xl font-semibold text-cyan-50 sm:text-5xl">
            Code and secrets stay under your control.
          </h1>
          <p className="mt-5 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Direct mode uses explicitly configured GitHub Actions or self-hosted
            runner credentials. Gateway mode uses server-managed enrollment and
            sends submitted review context through its relay to the selected
            provider.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/compare" variant="soft" tone="success">
              <Network aria-hidden="true" className="size-5" />
              Compare boundary
            </LinkButton>
            <LinkButton href="/getting-started" variant="outline">
              <BookOpen aria-hidden="true" className="size-5" />
              Setup guide
            </LinkButton>
          </div>
        </header>

        <section className="mt-14" aria-labelledby="security-signal-title">
          <h2
            id="security-signal-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            How the boundary works
          </h2>
          <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
            {securitySignals.map((signal) => (
              <div key={signal.title} className="flex gap-4">
                <signal.icon
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-cyan-300"
                />
                <div>
                  <dt className="font-semibold leading-6 text-cyan-50">
                    {signal.title}
                  </dt>
                  <dd className="mt-1 text-sm leading-6 text-slate-400">
                    {signal.body}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16" aria-labelledby="security-seed-title">
          <h2
            id="security-seed-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Seed secrets directly to GitHub
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            For direct workflow credentials, the helper validates provider auth
            locally and writes required secrets through <code>gh</code>.
            ReviewRouter does not receive these workflow credentials; dashboard
            state only tracks safe setup metadata.
          </p>
          <div className="mt-5">
            <CodeBlock code={secretCommand} />
          </div>
        </section>

        <section className="mt-16" aria-labelledby="security-details-title">
          <h2
            id="security-details-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Details
          </h2>
          <Tabs defaultValue="boundary" className="mt-6">
            <TabsList aria-label="Security details">
              <TabsTrigger value="boundary">Privacy boundary</TabsTrigger>
              <TabsTrigger value="permissions">App permissions</TabsTrigger>
              <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            </TabsList>

            <TabsContent value="boundary" keepMounted>
              <p className="mb-4 text-sm text-slate-400">
                The SaaS configures review. Your runtime performs review.
              </p>
              <div className={tableWrap}>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-cyan-200/12">
                      <th className={th}>Layer</th>
                      <th className={th}>Owned by</th>
                      <th className={th}>Sensitive data</th>
                      <th className={th}>Custody</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {boundaryRows.map((row) => (
                      <tr key={row.layer}>
                        <th
                          scope="row"
                          className={`${td} text-left font-semibold text-cyan-50`}
                        >
                          {row.layer}
                        </th>
                        <td className={`${td} text-slate-300`}>
                          {row.ownedBy}
                        </td>
                        <td className={`${td} text-slate-400`}>
                          {row.sensitiveData}
                        </td>
                        <td className={td}>
                          <Badge
                            size="xs"
                            tone={
                              row.custody === "Customer" ? "success" : "neutral"
                            }
                          >
                            {row.custody}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-400">
                Review context submitted for a review is sent to the selected
                model provider. Code running in the authorized CI job can use
                its scoped review grant. Tool environment filtering reduces
                exposure; it does not isolate the grant from that job&apos;s
                code.
              </p>
            </TabsContent>

            <TabsContent value="permissions" keepMounted>
              <p className="mb-4 text-sm text-slate-400">
                Permissions support setup and maintenance, not hosted code
                execution.
              </p>
              <div className={tableWrap}>
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-cyan-200/12">
                      <th className={th}>Permission</th>
                      <th className={th}>Access</th>
                      <th className={th}>Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {permissionRows.map((row) => (
                      <tr key={row.permission}>
                        <th
                          scope="row"
                          className={`${td} whitespace-nowrap text-left font-mono text-xs font-semibold text-cyan-100`}
                        >
                          {row.permission}
                        </th>
                        <td className={td}>
                          <Badge
                            size="xs"
                            tone={row.access === "Write" ? "warning" : "accent"}
                          >
                            {row.access}
                          </Badge>
                        </td>
                        <td className={`${td} leading-6 text-slate-400`}>
                          {row.reason}
                          {row.docs?.map((doc) => (
                            <a
                              key={doc.href}
                              href={doc.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 flex items-center gap-1 text-xs font-semibold text-cyan-200 hover:text-cyan-50"
                            >
                              {doc.label}
                              <ExternalLink
                                aria-hidden="true"
                                className="size-3"
                              />
                            </a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-500">
                GitHub repository and organization secret endpoints return
                metadata only. ReviewRouter uses those checks for setup
                verification, not decrypted secret access.
              </p>
            </TabsContent>

            <TabsContent value="webhooks" keepMounted>
              <p className="mb-4 text-sm text-slate-400">
                The hosted service needs lifecycle events to keep installations
                current.
              </p>
              <div className={tableWrap}>
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-cyan-200/12">
                      <th className={th}>Event</th>
                      <th className={th}>Handling</th>
                      <th className={th}>Used for</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-200/10">
                    {webhookRows.map((row) => (
                      <tr key={row.event}>
                        <th
                          scope="row"
                          className={`${td} text-left font-mono text-xs font-semibold text-cyan-100`}
                        >
                          {row.event}
                        </th>
                        <td className={td}>
                          <Badge
                            size="xs"
                            tone={row.handled ? "success" : "neutral"}
                          >
                            {row.handled ? "Processed" : "Not processed"}
                          </Badge>
                        </td>
                        <td className={`${td} leading-6 text-slate-400`}>
                          {row.use}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <section className="mt-16" aria-labelledby="security-faq-title">
          <h2
            id="security-faq-title"
            className="text-2xl font-semibold text-cyan-50 sm:text-3xl"
          >
            Narrow claim, explicit boundary
          </h2>
          <Accordion className="mt-6" defaultValue={["claim"]}>
            <AccordionItem value="claim">
              <AccordionTrigger>
                What does ReviewRouter store from a review?
              </AccordionTrigger>
              <AccordionContent>
                <p className="max-w-2xl leading-6">
                  Submitted review context is sent to the selected provider.
                  Stored review metadata and normalized findings may include
                  source excerpts.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="forks">
              <AccordionTrigger>
                Can a fork pull request reach my provider secrets?
              </AccordionTrigger>
              <AccordionContent>
                <p className="max-w-2xl leading-6">
                  Not by default. The generated workflow skips secret-backed
                  review for fork PRs, and a trusted rerun should be an explicit
                  maintainer action.
                </p>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="grant">
              <AccordionTrigger>
                Can code in the review job use the review grant?
              </AccordionTrigger>
              <AccordionContent>
                <p className="max-w-2xl leading-6">
                  Yes. Tool environment filtering reduces exposure, but it does
                  not isolate the scoped review grant from the code that runs in
                  the authorized CI job.
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <div className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-cyan-200/10 pt-8">
          <p className="text-lg font-semibold text-cyan-50">
            Ready to try it on your repository?
          </p>
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/dashboard" variant="soft" tone="success">
              <ShieldCheck aria-hidden="true" className="size-5" />
              Open dashboard
            </LinkButton>
            <LinkButton href="/" variant="outline">
              Back to overview
            </LinkButton>
          </div>
        </div>
      </div>
    </main>
  );
}
