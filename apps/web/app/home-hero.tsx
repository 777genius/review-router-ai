import { BookOpen, Database, KeyRound, ShieldCheck } from "lucide-react";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";
import { HomeReviewPreview } from "./home-review-preview";

const trustChips = [
  { icon: Database, label: "Metadata-only access" },
  { icon: ShieldCheck, label: "You control CI" },
  { icon: KeyRound, label: "BYO model keys" },
  { icon: BookOpen, label: "Free · fair use" },
] as const;

type HomeHeroProps = Omit<HomeCtaClusterProps, "size" | "className">;

export function HomeHero({
  appInstallUrl,
  hasConnectedApp,
  githubHref,
  githubLabel,
}: HomeHeroProps): React.ReactElement {
  return (
    <section
      aria-labelledby="home-hero-title"
      className="home-hero relative isolate overflow-hidden"
    >
      <div aria-hidden="true" className="home-hero__orbs">
        <span className="home-orb home-orb--cyan" />
        <span className="home-orb home-orb--lime" />
        <span className="home-orb home-orb--fuchsia" />
      </div>

      <div className="mx-auto grid w-[calc(100%-2rem)] max-w-7xl items-center gap-10 pb-8 pt-10 sm:w-[calc(100%-3rem)] lg:grid-cols-[minmax(0,1.04fr)_minmax(0,0.96fr)] lg:gap-12 lg:pb-12 lg:pt-16">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
            ReviewRouter Setup ///
            <span
              aria-hidden="true"
              className="home-hero__eyebrow-rule hidden h-px w-14 bg-gradient-to-r from-cyan-300/80 to-transparent sm:block"
            />
          </p>

          <h1
            id="home-hero-title"
            className="mt-5 text-[clamp(1.85rem,7.6vw,3.2rem)] font-semibold leading-[1.06] tracking-tight text-cyan-50 lg:text-[clamp(2.5rem,3.8vw,3.5rem)]"
          >
            Free privacy-first
            <br />
            AI code review
            <br />
            <span className="bg-gradient-to-r from-cyan-200 via-lime-200 to-cyan-100 bg-clip-text text-transparent">
              that stays inside your CI
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
            Connect your repository, add the workflow, and enable secure access
            for free. Reviews run in your GitHub Actions with the model you
            already use — the control plane reads metadata, not your source.
          </p>

          <HomeCtaCluster
            appInstallUrl={appInstallUrl}
            hasConnectedApp={hasConnectedApp}
            githubHref={githubHref}
            githubLabel={githubLabel}
            className="mt-7"
          />

          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
            {trustChips.map((chip) => {
              const Icon = chip.icon;

              return (
                <li
                  key={chip.label}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-300"
                >
                  <Icon aria-hidden="true" className="size-4 text-lime-300" />
                  {chip.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0">
          <HomeReviewPreview />
        </div>
      </div>
    </section>
  );
}
