import {
  Activity, ArrowRight, BarChart3, Check, GitPullRequest, Server, ShieldCheck,
} from "lucide-react";
import { HomeCtaCluster, type HomeCtaClusterProps } from "./home-cta-cluster";
import { HomeFindingsPreview } from "./home-findings-preview";
import { LogoMark } from "./logo-mark";
import { SourceProviderLogo } from "./source-provider-logo";
import styles from "./home-experience.module.css";

const sourceUrl = "https://github.com/777genius/review-router-ai";
const benchmarkUrl = "https://github.com/alibaba/open-code-review#benchmark";
const selfHostedGuide =
  "https://github.com/777genius/review-router-ai/blob/main/docs/operations/review-router-self-hosted-end-to-end.md";
const steps = [
  ["Choose repos", "GitHub App"],
  ["Review setup PR", "You approve"],
  ["Enable reviews", "Runs in CI"],
  ["Find issues", "AI comments"],
  ["See usage", "Dashboard"],
] as const;

export function HomeExperience(props: HomeCtaClusterProps): React.ReactElement {
  return (
    <div className={styles.experience}>
      <section className={styles.hero} aria-labelledby="home-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>
            <span className={styles.liveDot} aria-hidden="true" />
            OPEN SOURCE / FREE CONTROL PLANE
          </p>
          <h1 id="home-title">AI code review.<span> Your models. Your rules.</span></h1>
          <p className={styles.heroSummary}>
            Faster, focused reviews powered by OpenCodeReview. Bring your AI
            subscription or API key. See the usage you can measure.
          </p>
          <div className={styles.heroActions}>
            <HomeCtaCluster {...props} showGitLab={false} className={styles.ctaPrimary ?? ""} />
            <a className={styles.sourceButton} href={sourceUrl}>
              <SourceProviderLogo provider="github" className={styles.sourceIcon} />
              View source <ArrowRight aria-hidden="true" size={15} />
            </a>
          </div>
          <p className={styles.heroFineprint}>
            Hosted access is free under fair use. AI provider and CI costs are separate.
          </p>
          <div className={styles.heroFootnotes}>
            <span><Check aria-hidden="true" size={14} /> Open source</span>
            <span><Check aria-hidden="true" size={14} /> Your AI account</span>
            <span><Check aria-hidden="true" size={14} /> Hosted / self-hosted</span>
          </div>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.visualCorner} aria-hidden="true" />
          <HomeFindingsPreview />
          <p className={styles.visualCaption}>01 / WHAT A REVIEW FINDS</p>
        </div>
      </section>

      <section className={styles.benchmark} aria-labelledby="efficiency-title">
        <div className={styles.benchmarkIntro}>
          <p className={styles.kicker}>02 / THE ENGINE</p>
          <h2 id="efficiency-title">More signal.<span> Less overhead.</span></h2>
          <p>Purpose-built review, not a general coding agent running as a reviewer.</p>
          <a href={benchmarkUrl} className={styles.textLink}>
            See the upstream benchmark <ArrowRight aria-hidden="true" size={15} />
          </a>
        </div>
        <div className={styles.benchmarkMetrics}>
          <div className={styles.metric}>
            <strong>9.5<span>×</span></strong>
            <p>Faster review</p>
            <div className={styles.metricScale} aria-hidden="true">
              <span className={styles.metricFull} /><span className={styles.metricShort} />
            </div>
          </div>
          <div className={styles.metric}>
            <strong>14.7<span>×</span></strong>
            <p>Fewer tokens</p>
            <div className={styles.metricScale} aria-hidden="true">
              <span className={styles.metricFull} /><span className={styles.metricTiny} />
            </div>
          </div>
          <p className={styles.benchmarkNote}>
            Upstream AACR-Bench, Claude 4.6 Opus: OpenCodeReview v1.3.1 vs
            Claude Code v2.1.169. Lower recall in this comparison. Results are
            not ReviewRouter measurements or guaranteed cost savings.
          </p>
        </div>
      </section>

      <section className={styles.control} aria-labelledby="control-title">
        <div className={styles.sectionLead}>
          <p className={styles.kicker}>03 / COMPLETE VISIBILITY</p>
          <h2 id="control-title">Your AI. <span>Your usage.</span></h2>
          <p>
            Connect supported subscriptions or API keys, choose models and
            review policies, track reported tokens and costs.
          </p>
        </div>
        <div className={styles.dashboardPreview} aria-label="Illustrative dashboard interface">
          <header className={styles.dashboardHeader}>
            <span className={styles.dashboardIdentity}>
              <LogoMark size="xs" />
              <span><strong>ReviewRouter</strong><small>Usage overview</small></span>
            </span>
            <span className={styles.previewTag}>UI PREVIEW / NOT LIVE DATA</span>
          </header>
          <div className={styles.dashboardBody}>
            <div className={styles.dashboardSidebar}>
              <span className={styles.dashCategory}>WORKSPACE</span>
              <span className={styles.dashActive}><BarChart3 aria-hidden="true" size={17} /> Insights</span>
              <span><Activity aria-hidden="true" size={17} /> Review history</span>
              <span><ShieldCheck aria-hidden="true" size={17} /> Providers</span>
            </div>
            <div className={styles.dashboardMain}>
              <div className={styles.dashboardHeading}>
                <div><small>OVERVIEW</small><strong>Know what your reviews use</strong></div>
                <span>Known data only</span>
              </div>
              <div className={styles.insightGrid}>
                <div className={styles.insight}><small>REVIEW ACTIVITY</small><span className={styles.insightGlyph}>↗</span><p>Run history</p></div>
                <div className={styles.insight}><small>TOKENS USED</small><span className={styles.insightGlyph}>◎</span><p>Provider reports</p></div>
                <div className={styles.insight}><small>KNOWN COSTS</small><span className={styles.insightGlyph}>◈</span><p>No invented totals</p></div>
              </div>
              <div className={styles.usageChart}>
                <div className={styles.chartHeader}><strong>Usage by review</strong><span>Illustrative pattern</span></div>
                <div className={styles.chartBars} aria-hidden="true">
                  {[35,60,45,80,51,70,48,86,56,74,62,95,67,79,48,69,88,57].map((height,index)=>(
                    <span key={index} style={{ height: height + "%" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
          <p className={styles.dashboardNote}>
            Actual dashboard shows available provider/model data and unknown coverage explicitly.
          </p>
        </div>
      </section>

      <section className={styles.flowSection} aria-labelledby="flow-title">
        <div className={styles.sectionLead}>
          <p className={styles.kicker}>04 / FROM PR TO INSIGHT</p>
          <h2 id="flow-title">One clear <span>review flow.</span></h2>
        </div>
        <ol className={styles.journey}>
          {steps.map(([title,description],index)=>(
            <li key={title}>
              <span className={styles.stepNumber}>0{index + 1}</span>
              <strong>{title}</strong><small>{description}</small>
            </li>
          ))}
        </ol>
        <p className={styles.flowNotice}>
          <GitPullRequest aria-hidden="true" size={17} />
          Your CI runs the review; the selected AI provider receives the review context it needs.
        </p>
      </section>

      <section className={styles.hostingSection} aria-labelledby="hosting-title">
        <div className={styles.sectionLead}>
          <p className={styles.kicker}>05 / CHOOSE YOUR SETUP</p>
          <h2 id="hosting-title">Hosted or <span>self-hosted.</span></h2>
        </div>
        <div className={styles.hostingChoices}>
          <article className={styles.hosted}>
            <span className={styles.hostIcon}><Activity aria-hidden="true" size={23} /></span>
            <span className={styles.hostStatus}>READY TO USE</span>
            <h3>Hosted</h3>
            <p>Free control plane under fair use. Your GitHub CI and AI provider remain yours.</p>
            <a href="/getting-started" className={styles.hostLink}>Start with GitHub <ArrowRight aria-hidden="true" size={17} /></a>
          </article>
          <article className={styles.selfHosted}>
            <span className={styles.hostIcon}><Server aria-hidden="true" size={23} /></span>
            <span className={styles.hostStatus}>OPEN SOURCE</span>
            <h3>Self-hosted</h3>
            <p>Run the platform on your infrastructure, with the same source available to inspect.</p>
            <a href={selfHostedGuide} className={styles.hostLink}>Deployment guide <ArrowRight aria-hidden="true" size={17} /></a>
          </article>
        </div>
        <div className={styles.closing}>
          <strong>Open infrastructure. Your decisions.</strong>
          <nav aria-label="More about ReviewRouter">
            <a href="/compare">Compare</a>
            <a href="/security">Security</a>
            <a href="/fair-use">Fair use</a>
            <a href="/support">Support</a>
          </nav>
        </div>
      </section>
    </div>
  );
}
