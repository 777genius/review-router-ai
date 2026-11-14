import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Cloud,
  Cpu,
  Github,
  KeyRound,
  Server,
  ShieldCheck,
} from "lucide-react";
import { LogoMark } from "./logo-mark";

const chartBars = [24, 36, 31, 47, 42, 64, 51, 56, 44, 72, 59, 68, 55, 81, 71, 86, 75, 92] as const;

const workflow = [
  {
    icon: Github,
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
      <section className="rr-home-section rr-home-engine rr-home-motion" id="efficiency" aria-labelledby="rr-engine-title">
        <div className="rr-home-engine__intro">
          <div className="rr-home-engine__copy">
            <span className="rr-home-section-label">01 / The review engine</span>
            <h2 id="rr-engine-title">Purpose-built for code review.<br /><em>Not general agent loops.</em></h2>
            <p>Powered by the open-source <strong>OpenCodeReview</strong> engine.</p>
          </div>
          <div className="rr-home-engine__pill"><Cpu size={18} aria-hidden="true" /> OpenCodeReview</div>
        </div>
        <div className="rr-home-benchmark">
          <div className="rr-home-benchmark__metrics">
            <div className="rr-home-benchmark__metric">
              <span>~9.5×</span>
              <strong>faster</strong>
              <small>1:23 vs 13:06</small>
            </div>
            <div className="rr-home-benchmark__metric">
              <span>~14.7×</span>
              <strong>fewer tokens</strong>
              <small>385K vs 5,664K</small>
            </div>
          </div>
          <div className="rr-home-benchmark__visual">
            <p>Same model · Upstream AACR-Bench</p>
            <div className="rr-home-benchmark__bar">
              <span>Claude Code</span><i className="rr-home-benchmark__track"><b className="rr-home-benchmark__fill rr-home-benchmark__fill--agent" /></i>
            </div>
            <div className="rr-home-benchmark__bar">
              <span>OpenCodeReview</span><i className="rr-home-benchmark__track"><b className="rr-home-benchmark__fill rr-home-benchmark__fill--ocr" /></i>
            </div>
            <small>Illustrative token ratio (not billing or runtime telemetry)</small>
          </div>
        </div>
        <p className="rr-home-section-note">
          <a href="https://github.com/alibaba/open-code-review#benchmark" target="_blank" rel="noopener noreferrer">
            Alibaba upstream benchmark <ArrowUpRight size={13} aria-hidden="true" />
          </a>
          <span>These are engine results under specified test conditions, not independently measured ReviewRouter service speed or guaranteed bill savings. Review quality and recall vary.</span>
        </p>
      </section>

      <section className="rr-home-section rr-home-insights rr-home-motion" id="insights" aria-labelledby="rr-insights-title">
        <header className="rr-home-insights__heading">
          <span className="rr-home-section-label">02 / Your control room</span>
          <h2 id="rr-insights-title">Your models.<br /><em>Your usage.</em></h2>
          <p>Keep your subscription or API key. See what your review runs actually report.</p>
        </header>
        <div className="rr-home-insights__composition">
          <div className="rr-home-dashboard" aria-label="Illustrative dashboard preview, not live account data">
            <div className="rr-home-dashboard__sidebar">
              <div className="rr-home-dashboard__brand"><LogoMark size="xs" /><span>ReviewRouter</span></div>
              <span className="rr-home-dashboard__sidebar-active"><BarChart3 size={14} aria-hidden="true" /> Analytics</span>
              <span><ShieldCheck size={14} aria-hidden="true" /> Reviews</span>
              <span><KeyRound size={14} aria-hidden="true" /> Providers</span>
            </div>
            <div className="rr-home-dashboard__main">
              <div className="rr-home-dashboard__top"><strong>Usage overview</strong><span>ILLUSTRATIVE DATA · LAST 30 DAYS</span></div>
              <div className="rr-home-dashboard__stats">
                <div><small>Reviews</small><strong>42</strong><span>Example</span></div>
                <div><small>Reported tokens</small><strong>1.24M</strong><span>Example</span></div>
                <div><small>Known estimated cost</small><strong>$0.42</strong><span>Example only</span></div>
              </div>
              <div className="rr-home-dashboard__chart" aria-label="Illustrative token history chart">
                <div className="rr-home-dashboard__chart-label">TOKENS REPORTED / EXAMPLE</div>
                <div className="rr-home-dashboard__bars" aria-hidden="true">
                  {chartBars.map((height, index) => (
                    <span key={index} style={{ height: `${height}%` }} />
                  ))}
                </div>
              </div>
              <div className="rr-home-dashboard__foot"><span>Provider and model breakdown</span><span>Unknown coverage shown separately</span></div>
            </div>
          </div>
          <aside className="rr-home-insights__choice">
            <div className="rr-home-insights__choice-icon"><KeyRound size={22} aria-hidden="true" /></div>
            <h3>Bring your own AI.</h3>
            <p>Use a supported subscription or API key. Pick the review rules.</p>
            <div className="rr-home-insights__provider-labels">
              <span><img src="/service-icons/claude.svg" alt="" /> Claude</span>
              <span>Codex</span>
              <span>OpenRouter</span>
            </div>
            <div className="rr-home-insights__choice-bottom">
              <CheckCircle2 size={16} aria-hidden="true" />
              Costs are shown when reported — unknown is not zero.
            </div>
          </aside>
        </div>
      </section>

      <section className="rr-home-section rr-home-workflow rr-home-motion" id="how-it-works" aria-labelledby="rr-workflow-title">
        <header className="rr-home-workflow__heading">
          <span className="rr-home-section-label">03 / From PR to insight</span>
          <h2 id="rr-workflow-title">Connect. Review. <em>Understand.</em></h2>
          <p>One familiar flow, not another tool you have to babysit.</p>
        </header>
        <ol className="rr-home-workflow__steps">
          {workflow.map(({ icon: Icon, number, title, description }) => (
            <li key={number} className="rr-home-workflow__step">
              <div className="rr-home-workflow__step-top"><span>{number}</span><Icon size={24} aria-hidden="true" /></div>
              <h3>{title}</h3>
              <p>{description}</p>
            </li>
          ))}
        </ol>
        <p className="rr-home-section-note">Reviews execute in your GitHub Actions by default. The AI provider you choose receives the review context sent by the workflow.</p>
      </section>

      <section className="rr-home-section rr-home-hosting rr-home-motion" id="hosting" aria-labelledby="rr-hosting-title">
        <header className="rr-home-hosting__heading">
          <span className="rr-home-section-label">04 / Open platform</span>
          <h2 id="rr-hosting-title">Hosted or self-hosted.<br /><em>Always your choice.</em></h2>
        </header>
        <div className="rr-home-hosting__grid">
          <article className="rr-home-hosting__card rr-home-hosting__card--hosted">
            <div className="rr-home-hosting__card-head"><span className="rr-home-hosting__card-icon"><Cloud size={24} aria-hidden="true" /></span><h3>Hosted</h3><small>AVAILABLE</small></div>
            <p>Start with ReviewRouter's free control plane, subject to fair-use limits. Provider and CI costs are separate.</p>
            <a href="/getting-started" className="rr-home-hosting__link">Get started <ArrowRight size={17} aria-hidden="true" /></a>
          </article>
          <article className="rr-home-hosting__card rr-home-hosting__card--self">
            <div className="rr-home-hosting__card-head"><span className="rr-home-hosting__card-icon"><Server size={24} aria-hidden="true" /></span><h3>Self-hosted</h3><small>OPEN SOURCE</small></div>
            <p>Deploy the platform in your own infrastructure using the guided setup.</p>
            <a
              href="https://github.com/777genius/review-router-ai/tree/main/deploy/self-hosted"
              target="_blank"
              rel="noopener noreferrer"
              className="rr-home-hosting__link"
            >Deployment guide <ArrowUpRight size={17} aria-hidden="true" /></a>
          </article>
        </div>
        <div className="rr-home-hosting__source">
          <Github size={18} aria-hidden="true" />
          <span>Open source, inspectable, extensible.</span>
          <a href="https://github.com/777genius/review-router-ai" target="_blank" rel="noopener noreferrer">View repository <ArrowUpRight size={15} aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}
