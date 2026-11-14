"use client";

import { useState } from "react";
import { AlertCircle, ArrowUpRight, Check, GitPullRequest, ShieldCheck } from "lucide-react";
import styles from "./home-landing.module.css";

const findings = [
  {
    id: "critical",
    severity: "CRITICAL",
    title: "Unprotected admin route",
    place: "auth/session.ts",
    note: "Fix before merge",
  },
  {
    id: "major",
    severity: "MAJOR",
    title: "Race in concurrent updates",
    place: "jobs/worker.ts",
    note: "Review required",
  },
  {
    id: "minor",
    severity: "MINOR",
    title: "Missing retry boundary",
    place: "api/client.ts",
    note: "Follow-up suggested",
  },
  {
    id: "info",
    severity: "INFO",
    title: "Simplify unused branch",
    place: "utils/format.ts",
    note: "Optional improvement",
  },
] as const;

type FindingId = (typeof findings)[number]["id"];

export function HomeReviewDemo(): React.ReactElement {
  const [selected, setSelected] = useState<FindingId>("critical");
  const active = findings.find((item) => item.id === selected) ?? findings[0];

  return (
    <div className={styles.reviewFrame} aria-label="Illustrative pull request review">
      <div className={styles.reviewFrameTop}>
        <div className={styles.reviewDots} aria-hidden="true"><span/><span/><span/></div>
        <span>REVIEWROUTER / REVIEW RESULT</span>
        <span className={styles.previewLabel}>PREVIEW</span>
      </div>
      <div className={styles.reviewMeta}>
        <div className={styles.reviewMetaIcon}><GitPullRequest aria-hidden="true" size={22}/></div>
        <div><span>Pull request review</span><strong>Review completed</strong></div>
        <span className={styles.reviewCompleted}><Check size={14} aria-hidden="true"/> FINISHED</span>
      </div>
      <div className={styles.reviewSummary}>
        <strong>4 findings</strong>
        <span>Choose a severity to preview</span>
      </div>
      <div className={styles.findingList} role="group" aria-label="Example findings by severity">
        {findings.map((finding) => (
          <button
            key={finding.id}
            type="button"
            onClick={() => setSelected(finding.id)}
            aria-pressed={selected === finding.id}
            data-severity={finding.id}
            className={[styles.finding, selected === finding.id ? styles.findingActive : ""].filter(Boolean).join(" ")}
          >
            <span className={styles.findingSeverity}>{finding.severity}</span>
            <span className={styles.findingTitle}>{finding.title}</span>
            <ArrowUpRight aria-hidden="true" className={styles.findingArrow} size={16}/>
          </button>
        ))}
      </div>
      <div className={styles.findingDetail} aria-live="polite" aria-atomic="true">
        <div>
          <span><AlertCircle aria-hidden="true" size={14}/> SELECTED FINDING</span>
          <strong>{active.note}</strong>
        </div>
        <small>{active.place}</small>
      </div>
      <div className={styles.reviewFrameBottom}>
        <span><ShieldCheck aria-hidden="true" size={14}/> Evidence-backed review</span>
        <span>ILLUSTRATIVE, NOT CUSTOMER DATA</span>
      </div>
    </div>
  );
}
