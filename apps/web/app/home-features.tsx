import {
  BarChart3,
  BookOpen,
  Code2,
  Database,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@reviewrouter/ui";
import { LogoMark } from "./logo-mark";

const features = [
  {
    icon: ShieldCheck,
    title: "Your code never leaves CI",
    body: "Reviews run inside GitHub Actions on your runners. Source code and diffs are never uploaded to us.",
    badge: "Code stays put",
    tone: "lime",
  },
  {
    icon: Database,
    title: "We only see pull requests",
    body: "The GitHub App reads titles, statuses, and check results. It never opens your files.",
    badge: "No source access",
    tone: "cyan",
  },
  {
    icon: KeyRound,
    title: "Use your own AI",
    body: "Your Codex or Claude subscription, or a MiMo / OpenRouter API key. Keep credentials in GitHub Actions secrets or in our encrypted account pool — both are supported.",
    badge: "Bring your own model",
    tone: "cyan",
  },
  {
    icon: BarChart3,
    title: "Every comment has proof",
    body: "Each finding shows severity, the exact lines, and why it matters. No vague “consider refactoring” notes.",
    badge: "Evidence attached",
    tone: "fuchsia",
  },
  {
    icon: Code2,
    title: "You own the switch",
    body: "Setup arrives as a pull request. Merge it to turn reviews on, delete the workflow to turn them off.",
    badge: "Merge or delete",
    tone: "cyan",
  },
  {
    icon: BookOpen,
    title: "Free, with fair use",
    body: "Free for public repos and small private projects. No seats, no card, no surprise invoice.",
    badge: "No seat pricing",
    tone: "lime",
  },
] as const;

const toneStyles = {
  lime: {
    icon: "border-lime-300/30 bg-lime-300/[0.08] text-lime-200",
    badge: "success" as const,
  },
  cyan: {
    icon: "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200",
    badge: "accent" as const,
  },
  fuchsia: {
    icon: "border-fuchsia-400/30 bg-fuchsia-400/[0.08] text-fuchsia-200",
    badge: "accent" as const,
  },
} as const;

const modelOptions = ["Codex", "Claude", "MiMo", "OpenRouter"] as const;

export function HomeFeatures(): React.ReactElement {
  return (
    <section
      aria-labelledby="home-features-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-7xl sm:w-[calc(100%-3rem)]"
    >
      <div className="rr-reveal flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            What you get ///
          </p>
          <h2
            id="home-features-title"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-cyan-50 sm:text-4xl"
          >
            Review power without{" "}
            <span className="text-lime-300">handing over your code</span>
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-slate-400">
          The dashboard is hosted. The review itself runs where your code
          already lives. You pick the AI, keep the keys, and decide when it
          stops.
        </p>
      </div>

      <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)] lg:items-start lg:gap-10">
        <BoundaryMap />

        <div className="border-y border-cyan-200/10">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const tone = toneStyles[feature.tone];

            return (
              <article
                key={feature.title}
                className="feature-row rr-reveal group relative grid grid-cols-[auto_minmax(0,1fr)] gap-4 border-b border-cyan-200/10 py-5 last:border-b-0 sm:gap-5 sm:py-6"
              >
                <div className="flex flex-col items-center gap-3">
                  <span className="font-mono text-[0.64rem] font-semibold tracking-[0.14em] text-slate-500 transition-colors duration-300 group-hover:text-cyan-200">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`grid size-10 place-items-center rounded-full border transition duration-300 group-hover:scale-105 ${tone.icon}`}
                  >
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <h3 className="text-lg font-semibold leading-6 text-cyan-50">
                      {feature.title}
                    </h3>
                    <Badge
                      tone={tone.badge}
                      size="xs"
                      className="font-mono tracking-[0.12em]"
                    >
                      {feature.badge}
                    </Badge>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                    {feature.body}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function BoundaryMap(): React.ReactElement {
  return (
    <div className="home-boundary-map rr-reveal rr-reveal--fade relative isolate overflow-hidden rounded-[1.6rem] border border-cyan-200/14 bg-[var(--rr-surface-panel)] p-5 sm:p-6 lg:sticky lg:top-24">
      <div
        aria-hidden="true"
        className="home-boundary-map__grid absolute inset-0 -z-10"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent"
      />

      <p className="font-mono text-[0.66rem] font-semibold uppercase tracking-[0.2em] text-slate-500">
        Where everything lives ///
      </p>

      <div className="mt-5 rounded-2xl border border-lime-300/25 bg-lime-300/[0.045] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-lime-200">
            <Code2 aria-hidden="true" className="size-4" />
            Your GitHub Actions
          </span>
          <span className="rounded-full border border-lime-300/30 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-lime-200">
            Code stays here
          </span>
        </div>
        <p className="mt-4 font-mono text-xs leading-6 text-slate-300">
          diff <span className="text-lime-300">→</span> AI model{" "}
          <span className="text-lime-300">→</span> review comments
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {modelOptions.map((model) => (
            <span
              key={model}
              className="rounded-md border border-cyan-200/15 bg-white/[0.035] px-2 py-1 font-mono text-[0.62rem] font-semibold uppercase tracking-[0.1em] text-cyan-100"
            >
              {model}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">
          Your subscription or API key powers the model.
        </p>
      </div>

      <div aria-hidden="true" className="home-boundary-map__link" />

      <div className="rounded-2xl border border-cyan-200/16 bg-[var(--rr-surface-card-strong)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-cyan-200">
            <LogoMark size="xs" />
            ReviewRouter
          </span>
          <span className="rounded-full border border-cyan-200/20 px-2 py-0.5 font-mono text-[0.58rem] uppercase tracking-[0.14em] text-slate-400">
            Hosted dashboard
          </span>
        </div>
        <ul className="mt-3 grid gap-1.5 text-xs leading-5 text-slate-300">
          <li>Setup, review history, and health</li>
          <li>Pull request titles and check status</li>
          <li className="text-cyan-100">Never your code, never your keys</li>
        </ul>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-xl border border-fuchsia-300/20 bg-fuchsia-300/[0.05] p-3">
        <KeyRound
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-fuchsia-200"
        />
        <p className="text-xs leading-5 text-slate-300">
          <strong className="font-semibold text-cyan-50">Keys:</strong> GitHub
          Actions secrets, or our encrypted account pool. Both work; you choose
          where they live.
        </p>
      </div>

      <p className="mt-4 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-slate-500">
        RR /// boundary map 1.0
      </p>
    </div>
  );
}
