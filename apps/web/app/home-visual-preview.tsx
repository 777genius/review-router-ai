"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, GitCommitHorizontal, Radio, ShieldAlert } from "lucide-react";
import { LogoMark } from "./logo-mark";

type PreviewView = "findings" | "commits" | "usage";

const findings = [
  { severity: "Critical", tone: "critical", title: "Missing input validation" },
  { severity: "Major", tone: "major", title: "Duplicate request in a loop" },
  { severity: "Minor", tone: "minor", title: "Error path needs handling" },
] as const;

const commits = [
  { label: "Initial review", detail: "Finding reported", hash: "a37f12" },
  { label: "Add validation guard", detail: "Fix committed", hash: "b82a61" },
  { label: "Add regression tests", detail: "Checks updated", hash: "c61e94" },
] as const;

const views: { id: PreviewView; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "commits", label: "Commits" },
  { id: "usage", label: "Insights" },
];

export function HomeVisualPreview(): React.ReactElement {
  const [view, setView] = useState<PreviewView>("findings");

  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const elements = document.querySelectorAll<HTMLElement>(".rr-home-motion");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).dataset.motionVisible = "true";
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -12% 0px" },
    );
    for (const element of elements) observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rr-home-window" aria-label="Interactive example of ReviewRouter's review output">
      <div className="rr-home-window__header">
        <span className="rr-home-window__identity">
          <LogoMark size="xs" />
          <span>
            <strong>ReviewRouter</strong>
            <small>pull request / #482</small>
          </span>
        </span>
        <span className="rr-home-window__state">
          <CheckCircle2 aria-hidden="true" size={14} />
          Review complete
        </span>
      </div>

      <div className="rr-home-window__tabs" role="group" aria-label="Explore the example">
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={view === item.id}
            onClick={() => setView(item.id)}
            className="rr-home-window__tab"
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="rr-home-window__body" aria-live="polite" aria-atomic="true">
        {view === "findings" ? (
          <div className="rr-home-window__scene" key="findings">
            <div className="rr-home-window__scene-title">
              <span><ShieldAlert size={16} aria-hidden="true" /> Actionable findings</span>
              <strong>03</strong>
            </div>
            <ol className="rr-home-findings">
              {findings.map((finding, index) => (
                <li className="rr-home-finding" key={finding.title} style={{ animationDelay: `${index * 130}ms` }}>
                  <span className={`rr-home-finding__severity rr-home-finding__severity--${finding.tone}`}>
                    {finding.severity}
                  </span>
                  <span className="rr-home-finding__title">{finding.title}</span>
                  <span className="rr-home-finding__index" aria-hidden="true">0{index + 1}</span>
                </li>
              ))}
            </ol>
            <div className="rr-home-window__foot"><Radio size={13} aria-hidden="true" /> Severity · context · useful next step</div>
          </div>
        ) : view === "commits" ? (
          <div className="rr-home-window__scene" key="commits">
            <div className="rr-home-window__scene-title">
              <span><GitCommitHorizontal size={16} aria-hidden="true" /> Review history</span>
              <strong>03</strong>
            </div>
            <ol className="rr-home-commits">
              {commits.map((commit, index) => (
                <li className="rr-home-commit" key={commit.hash} style={{ animationDelay: `${index * 140}ms` }}>
                  <span className="rr-home-commit__node" aria-hidden="true" />
                  <span><strong>{commit.label}</strong><small>{commit.detail}</small></span>
                  <code>{commit.hash}</code>
                </li>
              ))}
            </ol>
            <div className="rr-home-window__foot">Illustrative commit sequence · not a live repository</div>
          </div>
        ) : (
          <div className="rr-home-window__scene" key="usage">
            <div className="rr-home-window__scene-title">
              <span><AlertCircle size={16} aria-hidden="true" /> Usage visibility</span>
              <strong>03</strong>
            </div>
            <div className="rr-home-usage">
              <div><small>YOUR AI</small><strong>Model choice</strong><span>Subscription or API key</span></div>
              <div><small>YOUR RUNS</small><strong>Token totals</strong><span>When provider-reported</span></div>
              <div><small>YOUR VIEW</small><strong>Known costs</strong><span>Unknown costs are labelled</span></div>
            </div>
            <div className="rr-home-window__foot">No fabricated account usage or live billing data</div>
          </div>
        )}
      </div>
      <p className="rr-home-window__disclaimer">Illustrative product interaction · sample findings, not an actual customer PR</p>
    </div>
  );
}
