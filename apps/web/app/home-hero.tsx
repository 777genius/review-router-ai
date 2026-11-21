import { ArrowUpRight } from "lucide-react";
import { SourceProviderLogo } from "./source-provider-logo";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";
import { HomeHeroBackdrop } from "./home-hero-backdrop";
import { HomeHeroVideo } from "./home-hero-video";
import { HomeProviders } from "./home-providers";
import {
  openCodeReviewRepoUrl,
  reviewRouterSourceCodeUrl,
} from "./public-urls";
// import { HomeVisualPreview } from "./home-visual-preview";

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
      <HomeHeroBackdrop />
      <div aria-hidden="true" className="rr-home-hero__signal" />
      <div className="rr-home-hero__grid">
        <div className="rr-home-hero__intro rr-home-motion">
          <h1 id="rr-home-title">
            Open-source
            <br />
            <span>AI code review.</span>
            <strong>Full control and security.</strong>
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
              href={reviewRouterSourceCodeUrl}
              className="rr-home-source"
              target="_blank"
              rel="noopener noreferrer"
            >
              <SourceProviderLogo
                provider="github"
                className="h-[18px] w-[18px]"
              />
              Source code <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
          <p className="rr-home-hero__fine">
            Hosted or self-hosted · No seat pricing · Provider and CI usage are
            separate
          </p>
        </div>
        <div className="rr-home-hero__visual rr-home-motion">
          <HomeHeroVideo />
          {/*
            Previous hero visual, parked until we decide where it goes:
            <HomeVisualPreview />
          */}
        </div>
      </div>
      <div className="rr-home-hero__bottom">
        <a
          href={openCodeReviewRepoUrl}
          className="rr-home-hero__powered"
          target="_blank"
          rel="noopener noreferrer"
        >
          POWERED BY <b>OpenCodeReview</b>
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        <HomeProviders />
      </div>
    </section>
  );
}
