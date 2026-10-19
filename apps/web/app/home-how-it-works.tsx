import { Database, KeyRound, ShieldCheck } from "lucide-react";
import { LinkButton } from "@reviewrouter/ui";

const steps = [
  {
    number: "01",
    title: "Install GitHub App",
    body: "Choose one repository, selected repositories, or an organization. ReviewRouter syncs metadata, not source code.",
  },
  {
    number: "02",
    title: "Merge setup PR",
    body: "A compact reusable workflow is added through a pull request, so your repository controls what runs in CI.",
  },
  {
    number: "03",
    title: "Connect provider",
    body: "Run one local command to seed Codex OAuth, Claude Code OAuth, or API keys directly into GitHub Actions secrets.",
  },
] as const;

const signals = [
  {
    icon: Database,
    title: "Data access",
    body: "Metadata only",
    tone: "cyan",
  },
  {
    icon: ShieldCheck,
    title: "Repo owned",
    body: "You control CI",
    tone: "lime",
  },
  {
    icon: KeyRound,
    title: "Secrets synced",
    body: "Stored in GitHub Actions secrets. Or use the encrypted account pool.",
    tone: "fuchsia",
  },
] as const;

const signalToneStyles = {
  cyan: "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200",
  lime: "border-lime-300/30 bg-lime-300/[0.08] text-lime-200",
  fuchsia: "border-fuchsia-400/30 bg-fuchsia-400/[0.08] text-fuchsia-200",
} as const;

export function HomeHowItWorks(): React.ReactElement {
  return (
    <section
      aria-labelledby="home-how-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-7xl sm:w-[calc(100%-3rem)]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            Setup ///
          </p>
          <h2
            id="home-how-title"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-cyan-50 sm:text-4xl"
          >
            Live in <span className="text-lime-300">three steps</span>
          </h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <LinkButton href="/getting-started" variant="soft" tone="success">
            Read the setup guide
          </LinkButton>
          <LinkButton href="/security" variant="outline">
            How security works
          </LinkButton>
        </div>
      </div>

      <div className="relative mt-8 grid gap-4 lg:grid-cols-3">
        <div
          aria-hidden="true"
          className="absolute left-[16%] right-[16%] top-[3.4rem] hidden h-px bg-gradient-to-r from-cyan-300/10 via-lime-300/45 to-cyan-300/10 lg:block"
        />
        {steps.map((step) => (
          <article
            key={step.number}
            className="home-step-card relative isolate rounded-[1.4rem] border border-cyan-200/14 bg-[var(--rr-surface-panel)] p-6 pt-8 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/30"
          >
            <span className="absolute -top-4 left-6 inline-flex h-9 items-center rounded-full border border-cyan-300/35 bg-[var(--rr-surface-card-strong)] px-3.5 font-mono text-sm font-bold tracking-[0.12em] text-cyan-100 shadow-[0_14px_32px_-22px_rgba(0,240,255,1)]">
              {step.number}
            </span>
            <h3 className="text-lg font-semibold leading-6 text-cyan-50">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">{step.body}</p>
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-4 rounded-[1.4rem] border border-cyan-200/12 bg-white/[0.02] p-5 sm:grid-cols-3">
        {signals.map((signal) => {
          const Icon = signal.icon;

          return (
            <div key={signal.title} className="flex items-start gap-3">
              <div
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${signalToneStyles[signal.tone]}`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0">
                <strong className="block font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {signal.title}
                </strong>
                <span className="mt-1 block text-sm leading-6 text-slate-300">
                  {signal.body}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
