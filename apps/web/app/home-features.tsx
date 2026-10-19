import {
  BarChart3,
  BookOpen,
  Code2,
  Database,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@reviewrouter/ui";

const features = [
  {
    icon: ShieldCheck,
    title: "Your code never leaves your CI",
    body: "Reviews run as a compact reusable workflow inside your GitHub Actions. Source code is never uploaded to ReviewRouter — the model reads the diff in your runner and posts findings back to the pull request.",
    span: "sm:col-span-2",
    tone: "lime",
  },
  {
    icon: Database,
    title: "Metadata-only access",
    body: "The GitHub App reads pull request and workflow metadata, not your source tree. The control plane orchestrates; it does not copy code.",
    span: "",
    tone: "cyan",
  },
  {
    icon: KeyRound,
    title: "Bring your own model",
    body: "Seed Codex OAuth, Claude Code OAuth, or API keys into GitHub Actions secrets with one local command — or use the encrypted account pool.",
    span: "",
    tone: "cyan",
  },
  {
    icon: BarChart3,
    title: "Findings with evidence",
    body: "Every finding ships with severity, evidence, and a quality trace you can audit. No vibes-only comments.",
    span: "sm:col-span-2",
    tone: "fuchsia",
  },
  {
    icon: Code2,
    title: "Repository-owned setup",
    body: "The workflow lands as a pull request your team reviews and merges. Your repository decides what runs in CI, and deleting the workflow switches reviews off.",
    span: "sm:col-span-2",
    tone: "cyan",
  },
] as const;

const toneStyles = {
  lime: {
    icon: "border-lime-300/30 bg-lime-300/[0.08] text-lime-200",
    halo: "group-hover:shadow-[0_0_44px_-18px_rgba(163,230,53,0.85)]",
    badge: "success" as const,
  },
  cyan: {
    icon: "border-cyan-300/25 bg-cyan-300/[0.08] text-cyan-200",
    halo: "group-hover:shadow-[0_0_44px_-18px_rgba(0,240,255,0.85)]",
    badge: "accent" as const,
  },
  fuchsia: {
    icon: "border-fuchsia-400/30 bg-fuchsia-400/[0.08] text-fuchsia-200",
    halo: "group-hover:shadow-[0_0_44px_-18px_rgba(217,70,239,0.85)]",
    badge: "accent" as const,
  },
} as const;

const featureBadges: Record<string, string> = {
  "Your code never leaves your CI": "Private by construction",
  "Metadata-only access": "Least privilege",
  "Bring your own model": "Codex · Claude · API keys",
  "Findings with evidence": "Auditable output",
  "Repository-owned setup": "You control CI",
};

export function HomeFeatures(): React.ReactElement {
  return (
    <section
      aria-labelledby="home-features-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-7xl sm:w-[calc(100%-3rem)]"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="home-section-eyebrow">Capabilities ///</p>
          <h2
            id="home-features-title"
            className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-cyan-50 sm:text-4xl"
          >
            Review power without{" "}
            <span className="text-lime-300">handing over your code</span>
          </h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-slate-400">
          ReviewRouter is a metadata control plane for CI-native AI review: the
          model works where your code already lives, and you keep the keys, the
          data, and the execution.
        </p>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          const tone = toneStyles[feature.tone];

          return (
            <article
              key={feature.title}
              className={`home-feature-card group relative isolate overflow-hidden rounded-[1.4rem] border border-cyan-200/14 bg-[var(--rr-surface-panel)] p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-200/32 ${tone.halo} ${feature.span}`}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent opacity-60"
              />
              <div
                className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${tone.icon}`}
              >
                <Icon aria-hidden="true" className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold leading-6 text-cyan-50">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {feature.body}
              </p>
              <Badge
                tone={tone.badge}
                size="xs"
                className="mt-4 font-mono tracking-[0.14em]"
              >
                {featureBadges[feature.title]}
              </Badge>
            </article>
          );
        })}

        <article className="home-feature-card group relative isolate overflow-hidden rounded-[1.4rem] border border-lime-300/28 bg-[linear-gradient(140deg,rgba(163,230,53,0.1),rgba(0,240,255,0.05),rgba(217,70,239,0.07))] p-6 transition duration-300 hover:-translate-y-1">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-lime-200/70 to-transparent"
          />
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-lime-300/30 bg-lime-300/[0.08] text-lime-200">
            <BookOpen aria-hidden="true" className="size-5" />
          </div>
          <h3 className="mt-4 text-lg font-semibold leading-6 text-cyan-50">
            Free, with fair use
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Free for public and small private work, with clear fair-use limits
            and no seat pricing. Cancel by deleting the workflow.
          </p>
          <Badge
            tone="success"
            size="xs"
            className="mt-4 font-mono tracking-[0.14em]"
          >
            No seat pricing
          </Badge>
        </article>
      </div>
    </section>
  );
}
