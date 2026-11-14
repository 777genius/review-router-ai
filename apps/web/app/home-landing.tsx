import { ArrowRight, BookOpen, Check, Cloud, GitBranch, GitPullRequest, KeyRound, LockKeyhole, Server, ShieldCheck } from "lucide-react";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";
import { HomeReviewDemo } from "./home-review-demo";
import { LogoMark } from "./logo-mark";
import styles from "./home-landing.module.css";

type HomeLandingProps = Omit<
  HomeCtaClusterProps,
  "size" | "className" | "ctaClassName" | "labelClassName" | "showGitLabBeta"
>;

const platformRepo = "https://github.com/777genius/review-router-ai";
const engineRepo = "https://github.com/alibaba/open-code-review";
const benchmarkPaper = "https://arxiv.org/abs/2608.09290";
const selfHostGuide = "https://github.com/777genius/review-router-ai/blob/main/docs/operations/review-router-self-hosted-end-to-end.md";

const sampleBars = [
  "short", "medium", "small", "tall", "medium", "large", "short", "medium",
  "tall", "large", "medium", "tall", "large", "short", "medium", "large",
  "tall", "medium", "large", "tall", "medium", "large", "tall", "large",
] as const;

const faq = [
  {
    question: "Is ReviewRouter free?",
    answer:
      "The current hosted control plane is free within fair-use limits. Your AI subscription, provider API usage and CI runners may have separate costs.",
  },
  {
    question: "Can I bring my own AI?",
    answer:
      "Yes. Choose a supported subscription or API-key provider and configure your review model and rules. Availability depends on provider and setup.",
  },
  {
    question: "Can I self-host it?",
    answer:
      "Yes. The open-source platform has a guided self-hosted deployment. Your chosen AI provider still receives the review context needed to run the model.",
  },
] as const;

export function HomeLanding(props: HomeLandingProps): React.ReactElement {
  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroInner}>
          <div className={styles.heroCopy}>
            <p className={styles.openSourceTag}><span className={styles.statusDot} /> OPEN SOURCE <span className={styles.tagDivider}>/</span> FREE CONTROL PLANE</p>
            <h1 id="landing-title" className={styles.heroHeading}>
              AI code review.
              <span>Your models.<br />Your rules.</span>
            </h1>
            <p className={styles.heroDescription}>
              Focused pull-request findings, your own AI subscriptions, and
              clear visibility into known token usage and costs.
            </p>
            <div className={styles.heroActions}>
              <HomeCtaCluster
                {...props}
                showGitLabBeta={false}
                className={styles.ctaGroup}
              />
              <a className={styles.sourceLink} href={platformRepo} target="_blank" rel="noopener noreferrer">
                <BookOpen aria-hidden="true" size={17} />
                View source <ArrowRight aria-hidden="true" size={15} />
              </a>
            </div>
            <p className={styles.heroFootnote}>
              Free under fair-use limits. AI provider and CI costs are separate.
            </p>
            <div className={styles.heroTrust}>
              <span><Check aria-hidden="true" size={14} /> Apache-2.0</span>
              <span><Check aria-hidden="true" size={14} /> Hosted or self-hosted</span>
              <span><Check aria-hidden="true" size={14} /> Your model choice</span>
            </div>
          </div>
          <div className={styles.heroVisual}>
            <HomeReviewDemo />
          </div>
        </div>
        <div className={styles.heroBottom}>
          <span>POWERED BY <a href={engineRepo} target="_blank" rel="noopener noreferrer">OPEN CODE REVIEW <ArrowRight aria-hidden="true" size={13}/></a></span>
          <span className={styles.heroBottomNote}>Purpose-built engine. A platform you control.</span>
        </div>
      </section>

      <section className={[styles.chapter, styles.efficiency].join(" ")} id="efficiency" aria-labelledby="efficiency-title">
        <div className={styles.chapterIntro}>
          <div className={styles.chapterMarker}><span className={styles.markerDash} /> THE ENGINE</div>
          <h2 id="efficiency-title" className={styles.efficiencyTitle}>More signal.<br /><span>Less overhead.</span></h2>
          <p>OpenCodeReview combines deterministic checks with targeted AI analysis. The result: focused review with substantially less model work in an upstream same-model benchmark.</p>
        </div>
        <div className={styles.benchmark}>
          <div className={styles.benchmarkHeader}>
            <span>AACR-BENCH / CLAUDE 4.6 OPUS</span>
            <a href={benchmarkPaper} target="_blank" rel="noopener noreferrer">View research <ArrowRight aria-hidden="true" size={14}/></a>
          </div>
          <div className={styles.metricCompare}>
            <div className={styles.metric}>
              <span className={styles.metricValue}>9.5<span>×</span></span>
              <strong>FASTER</strong>
              <div className={styles.metricBars} aria-label="OpenCodeReview 1 minute 23 seconds, Claude Code 13 minutes 6 seconds">
                <div className={styles.barItem}><span>OpenCodeReview</span><div className={styles.barTrack}><div className={[styles.barFill, styles.barCyan, styles.barFast].join(" ")} /></div><em>1:23</em></div>
                <div className={styles.barItem}><span>Claude Code</span><div className={styles.barTrack}><div className={[styles.barFill, styles.barMuted, styles.barFull].join(" ")} /></div><em>13:06</em></div>
              </div>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}><span className={styles.lime}>14.7</span><span>×</span></span>
              <strong>FEWER TOKENS</strong>
              <div className={styles.metricBars} aria-label="OpenCodeReview 385 thousand tokens, Claude Code 5 million 664 thousand tokens">
                <div className={styles.barItem}><span>OpenCodeReview</span><div className={styles.barTrack}><div className={[styles.barFill, styles.barLime, styles.barLean].join(" ")} /></div><em>385K</em></div>
                <div className={styles.barItem}><span>Claude Code</span><div className={styles.barTrack}><div className={[styles.barFill, styles.barMuted, styles.barFull].join(" ")} /></div><em>5,664K</em></div>
              </div>
            </div>
          </div>
          <p className={styles.benchmarkNote}>Source: Alibaba OpenCodeReview, AACR-Bench, Claude 4.6 Opus. Upstream engine results, not a separate ReviewRouter measurement. Recall was lower for OpenCodeReview in this comparison. Actual time, token use and provider charges vary.</p>
        </div>
      </section>

      <section className={[styles.chapter, styles.control].join(" ")} id="control" aria-labelledby="control-title">
        <div className={styles.controlTitleRow}>
          <div>
            <div className={styles.chapterMarker}><span className={styles.markerDash} /> IN YOUR HANDS</div>
            <h2 id="control-title" className={styles.chapterTitle}>Your AI.<br /><span>Your visibility.</span></h2>
          </div>
          <p>Use a supported subscription or API key. Choose review settings and see the usage your providers report — all in one dashboard.</p>
        </div>
        <div className={styles.console} aria-label="Illustrative ReviewRouter dashboard showing available usage and models">
          <div className={styles.consoleHeader}>
            <div className={styles.consoleBrand}><LogoMark size="xs" /> <div><strong>ReviewRouter</strong><span>/ Dashboard</span></div></div>
            <span className={styles.sampleTag}>ILLUSTRATIVE INTERFACE</span>
            <span className={styles.consoleLive}><span /> Workspace overview</span>
          </div>
          <div className={styles.consoleLayout}>
            <div className={styles.consoleSide} aria-label="Illustrative dashboard sections">
              <span className={styles.consoleNavActive}>Overview</span>
              <span>Providers</span>
              <span>Review history</span>
              <span>Usage</span>
              <span>Statistics</span>
            </div>
            <div className={styles.consoleMain}>
              <div className={styles.consoleTop}>
                <div><small>WORKSPACE INSIGHTS</small><h3>Review activity</h3></div>
                <span>LAST 30 DAYS <span aria-hidden="true">⌄</span></span>
              </div>
              <div className={styles.consoleSummary}>
                <div><span>Connected models</span><strong>Codex <span className={styles.consoleModelDot}/></strong><small>Claude · OpenRouter · and more</small></div>
                <div><span>Token usage</span><strong>By model</strong><small>Coverage-aware reporting</small></div>
                <div><span>Known costs</span><strong>By run</strong><small>Unknown values stay unknown</small></div>
              </div>
              <div className={styles.consoleBottom}>
                <div className={styles.chartPanel}>
                  <div className={styles.chartPanelHead}><h4>Token activity</h4><span>Illustrative trend</span></div>
                  <div className={styles.barChart} aria-hidden="true">
                    {sampleBars.map((kind, index) => (
                      <span key={index} className={[styles.chartBar, styles[kind]].join(" ")} />
                    ))}
                  </div>
                  <div className={styles.chartFoot}><span>Earlier</span><span>Recent</span></div>
                </div>
                <div className={styles.modelPanel}>
                  <div className={styles.chartPanelHead}><h4>Review controls</h4><ShieldCheck aria-hidden="true" size={18}/></div>
                  <div className={styles.modelLine}><KeyRound aria-hidden="true" size={18}/><div><strong>Own subscription</strong><small>Choose a supported account</small></div><Check size={17} aria-hidden="true"/></div>
                  <div className={styles.modelLine}><GitPullRequest aria-hidden="true" size={18}/><div><strong>Review policies</strong><small>Configure by repository</small></div><Check size={17} aria-hidden="true"/></div>
                  <div className={styles.modelLine}><GitBranch aria-hidden="true" size={18}/><div><strong>Review history</strong><small>See runs and findings</small></div><Check size={17} aria-hidden="true"/></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.underConsole}>
          <span><ShieldCheck aria-hidden="true" size={17} /> Model and account choices are yours</span>
          <span>Sample visuals are not live customer usage.</span>
        </div>
      </section>

      <section className={[styles.chapter, styles.pipeline].join(" ")} id="how-it-works" aria-labelledby="flow-title">
        <div className={styles.chapterMarker}><span className={styles.markerDash} /> HOW IT WORKS</div>
        <h2 id="flow-title" className={styles.chapterTitle}>From pull request<br /><span>to useful feedback.</span></h2>
        <div className={styles.pipelineSteps}>
          <div className={styles.pipelineStep}>
            <div className={styles.pipelineIcon}><GitPullRequest aria-hidden="true" size={30}/></div>
            <strong>Connect GitHub</strong>
            <span>Choose repos and merge a reviewable setup PR.</span>
          </div>
          <div className={styles.pipelineArrow} aria-hidden="true"><ArrowRight size={25}/></div>
          <div className={styles.pipelineStep}>
            <div className={styles.pipelineIcon}><ShieldCheck aria-hidden="true" size={30}/></div>
            <strong>Review in your CI</strong>
            <span>OpenCodeReview uses your chosen AI. The model provider receives review context.</span>
          </div>
          <div className={styles.pipelineArrow} aria-hidden="true"><ArrowRight size={25}/></div>
          <div className={styles.pipelineStep}>
            <div className={styles.pipelineIcon}><GitBranch aria-hidden="true" size={30}/></div>
            <strong>See what matters</strong>
            <span>Inline findings, review history and usage insights.</span>
          </div>
        </div>
        <a className={styles.textLink} href="/getting-started">How setup works <ArrowRight aria-hidden="true" size={16}/></a>
      </section>

      <section className={[styles.chapter, styles.hosting].join(" ")} id="hosting" aria-labelledby="hosting-title">
        <div className={styles.chapterMarker}><span className={styles.markerDash} /> TWO WAYS TO RUN</div>
        <h2 id="hosting-title" className={styles.chapterTitle}>Open source.<br /><span>Open choices.</span></h2>
        <div className={styles.hostingOptions}>
          <article className={styles.hostingOption}>
            <div className={styles.hostingLabel}><Cloud aria-hidden="true" size={27}/><span>HOSTED</span></div>
            <h3>Start free.</h3>
            <p>Use our hosted control plane, while review execution runs in your GitHub Actions by default.</p>
            <a href="/getting-started">Get started <ArrowRight aria-hidden="true" size={19}/></a>
            <small>Fair-use limits apply; provider and CI costs are separate.</small>
          </article>
          <article className={styles.hostingOption}>
            <div className={styles.hostingLabel}><Server aria-hidden="true" size={27}/><span>SELF-HOSTED</span></div>
            <h3>Run it yourself.</h3>
            <p>Deploy the open-source platform on your infrastructure with our guided installer.</p>
            <a href={selfHostGuide} target="_blank" rel="noopener noreferrer">Self-hosting guide <ArrowRight aria-hidden="true" size={19}/></a>
            <small>Your infrastructure, your operating costs.</small>
          </article>
        </div>
        <div className={styles.sourceBottom}>
          <div><LockKeyhole aria-hidden="true" size={20}/><span>Public source. Inspectable setup. No seat pricing for the current free beta.</span></div>
          <a href={platformRepo} target="_blank" rel="noopener noreferrer">Explore source <ArrowRight aria-hidden="true" size={15}/></a>
        </div>
        <div className={styles.faq}>
          <h2>Quick answers.</h2>
          {faq.map((item) => (
            <details key={item.question}>
              <summary>{item.question}<span aria-hidden="true">+</span></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
        <div className={styles.finalAction}>
          <h2>Make your next PR review yours.</h2>
          <HomeCtaCluster {...props} showGitLabBeta={false} className={styles.ctaGroup} />
          <div className={styles.finalLinks}>
            <a href="/fair-use">Fair-use limits</a>
            <a href="/security">Privacy &amp; security</a>
            <span>GitLab support is in development</span>
          </div>
        </div>
      </section>
    </div>
  );
}
