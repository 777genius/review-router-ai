import { LockKeyhole } from "lucide-react";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";

type HomeFinalCtaProps = Omit<HomeCtaClusterProps, "size" | "className">;

export function HomeFinalCta({
  appInstallUrl,
  hasConnectedApp,
  githubHref,
  githubLabel,
}: HomeFinalCtaProps): React.ReactElement {
  return (
    <section
      aria-labelledby="home-final-title"
      className="mx-auto w-[calc(100%-2rem)] max-w-7xl sm:w-[calc(100%-3rem)]"
    >
      <div className="rr-reveal relative isolate overflow-hidden rounded-[1.8rem] border border-fuchsia-400/25 bg-[linear-gradient(120deg,rgba(217,70,239,0.1),rgba(0,240,255,0.07),rgba(163,230,53,0.09))] px-6 py-12 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_90px_-50px_rgba(217,70,239,0.9)] sm:px-10">
        <div
          aria-hidden="true"
          className="home-final-cta__line pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-fuchsia-200/70 to-transparent"
        />

        <p className="inline-flex items-center gap-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">
          Start ///
        </p>
        <h2
          id="home-final-title"
          className="mx-auto mt-4 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-cyan-50 sm:text-4xl"
        >
          Ship reviews that{" "}
          <span className="text-lime-300">stay inside your CI</span>
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-300">
          Connect your repo, merge one small workflow, and start using your own
          AI — free.
        </p>

        <HomeCtaCluster
          appInstallUrl={appInstallUrl}
          hasConnectedApp={hasConnectedApp}
          githubHref={githubHref}
          githubLabel={githubLabel}
          className="mt-7 justify-center"
        />

        <p className="mx-auto mt-6 inline-flex max-w-full items-center gap-2 text-xs leading-5 text-slate-400">
          <LockKeyhole
            aria-hidden="true"
            className="size-4 shrink-0 text-lime-300"
          />
          Pull request info only · fair use · delete the workflow to stop
        </p>
      </div>
    </section>
  );
}
