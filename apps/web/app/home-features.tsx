import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Cloud,
  Cpu,
  GitBranch,
  Server,
} from "lucide-react";
import { SourceProviderLogo } from "./source-provider-logo";
import { HomeScreenshotCarousel } from "./home-screenshot-carousel";
import { HomeBenchmark } from "./home-benchmark";
import { reviewRouterSourceCodeUrl } from "./public-urls";

const workflow = [
  {
    icon: GitBranch,
    number: "01",
    title: "Connect GitHub",
    description: "Install the app. Approve the setup PR.",
  },
  {
    icon: Cpu,
    number: "02",
    title: "Review in your CI",
    description: "OpenCodeReview uses your chosen AI provider.",
  },
  {
    icon: BarChart3,
    number: "03",
    title: "See the results",
    description: "Findings, token usage and known cost data.",
  },
] as const;

export function HomeFeatures(): React.ReactElement {
  return (
    <>
      <section
        className="rr-home-section rr-home-engine rr-home-motion"
        id="efficiency"
        aria-labelledby="rr-engine-title"
      >
        <div className="rr-home-engine__intro">
          <div className="rr-home-engine__copy">
            <h2 id="rr-engine-title">
              Purpose-built for code review
              <br />
              <em>Not general agent loops</em>
            </h2>
            <p>
              Powered by the open-source <strong>OpenCodeReview</strong> engine.
            </p>
          </div>
        </div>
        <HomeBenchmark />
      </section>

      <section
        className="rr-home-section rr-home-insights rr-home-motion"
        id="insights"
        aria-labelledby="rr-insights-title"
      >
        <header className="rr-home-insights__heading">
          <h2 id="rr-insights-title">
            Your models
            <br />
            <em>Your usage</em>
          </h2>
          <p>
            Keep your subscription or API key. See what your review runs
            actually report. Costs are shown when reported — unknown is not
            zero.
          </p>
        </header>
        <HomeScreenshotCarousel />
      </section>

      <section
        className="rr-home-section rr-home-workflow rr-home-motion"
        id="how-it-works"
        aria-labelledby="rr-workflow-title"
      >
        <header className="rr-home-workflow__heading">
          <h2 id="rr-workflow-title">
            Connect. Review. <em>Understand</em>
          </h2>
          <p>One familiar flow, not another tool you have to babysit.</p>
        </header>
        <ol className="rr-home-workflow__steps">
          {workflow.map(({ icon: Icon, number, title, description }) => (
            <li key={number} className="rr-home-workflow__step">
              <div className="rr-home-workflow__step-top">
                <span>{number}</span>
                <Icon size={24} aria-hidden="true" />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
        <p className="rr-home-section-note">
          Reviews execute in your GitHub Actions by default. The AI provider you
          choose receives the review context sent by the workflow.
        </p>
      </section>

      <section
        className="rr-home-section rr-home-hosting rr-home-motion"
        id="hosting"
        aria-labelledby="rr-hosting-title"
      >
        <header className="rr-home-hosting__heading">
          <h2 id="rr-hosting-title">
            Hosted or self-hosted
            <br />
            <em>Always your choice</em>
          </h2>
        </header>
        <div className="rr-home-hosting__grid">
          <article className="rr-home-hosting__card rr-home-hosting__card--hosted">
            <div className="rr-home-hosting__card-head">
              <span className="rr-home-hosting__card-icon">
                <Cloud size={24} aria-hidden="true" />
              </span>
              <h3>Hosted</h3>
              <small>AVAILABLE</small>
            </div>
            <p>
              Start with ReviewRouter's free control plane, subject to fair-use
              limits. Provider and CI costs are separate.
            </p>
            <a href="/getting-started" className="rr-home-hosting__link">
              Get started <ArrowRight size={17} aria-hidden="true" />
            </a>
          </article>
          <article className="rr-home-hosting__card rr-home-hosting__card--self">
            <div className="rr-home-hosting__card-head">
              <span className="rr-home-hosting__card-icon">
                <Server size={24} aria-hidden="true" />
              </span>
              <h3>Self-hosted</h3>
              <small>OPEN SOURCE</small>
            </div>
            <p>
              Deploy the platform in your own infrastructure using the guided
              setup.
            </p>
            <a
              href={`${reviewRouterSourceCodeUrl}/tree/main/deploy/self-hosted`}
              target="_blank"
              rel="noopener noreferrer"
              className="rr-home-hosting__link"
            >
              Deployment guide <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </article>
        </div>
        <div className="rr-home-hosting__source">
          <SourceProviderLogo provider="github" className="h-[18px] w-[18px]" />
          <span>Open source, inspectable, extensible.</span>
          <a
            href={reviewRouterSourceCodeUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View repository <ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      </section>
    </>
  );
}
