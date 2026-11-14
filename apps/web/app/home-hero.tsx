import { ArrowUpRight, Github, RadioTower } from "lucide-react";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";
import { HomeVisualPreview } from "./home-visual-preview";

type HomeHeroProps = Omit<
  HomeCtaClusterProps,
  "size" | "className" | "ctaClassName" | "labelClassName"
>;

export function HomeHero({
  appInstallUrl,
  hasConnectedApp,
  githubHref,
  githubLabel,
}: HomeHeroProps): React.ReactElement {
  return (
    <section className="rr-home-hero" aria-labelledby="rr-home-title">
      <div aria-hidden="true" className="rr-home-hero__signal" />
      <div className="rr-home-hero__grid">
        <div className="rr-home-hero__intro rr-home-motion">
          <p className="rr-home-kicker">
            <RadioTower size={14} aria-hidden="true" /> OPEN SOURCE · FREE TO
            START
          </p>
          <h1 id="rr-home-title">
            Open-source
            <br />
            <span>AI code review.</span>
            <strong>Your model. Your budget.</strong>
          </h1>
          <p className="rr-home-hero__lead">
            Fast, focused pull request reviews. Use a supported AI subscription
            or API key — and see your reported tokens and costs.
          </p>
          <div className="rr-home-hero__actions">
            <HomeCtaCluster
              appInstallUrl={appInstallUrl}
              hasConnectedApp={hasConnectedApp}
              githubHref={githubHref}
              githubLabel={githubLabel}
              className="rr-home-hero__install"
            />
            <a
              href="https://github.com/777genius/review-router-ai"
              className="rr-home-source"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github size={18} aria-hidden="true" />
              Source code <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <p className="rr-home-hero__fine">
            Hosted or self-hosted · No seat pricing · Provider and CI usage are
            separate
          </p>
        </div>
        <div className="rr-home-hero__visual rr-home-motion">
          <HomeVisualPreview />
        </div>
      </div>
      <div className="rr-home-hero__bottom">
        <span>
          POWERED BY <b>OpenCodeReview</b>
        </span>
        <span className="rr-home-hero__divider" aria-hidden="true" />
        <span>RUNS IN YOUR CI</span>
        <span className="rr-home-hero__divider" aria-hidden="true" />
        <span>YOUR MODEL · YOUR RULES</span>
      </div>
    </section>
  );
}
