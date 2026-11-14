"use client";

import { useState } from "react";
import { Check, GitPullRequest, ShieldAlert } from "lucide-react";
import { LogoMark } from "./logo-mark";
import styles from "./home-experience.module.css";

const findings = [
  { label: "Critical", category: "Security", tone: "critical" },
  { label: "Major", category: "Correctness", tone: "major" },
  { label: "Minor", category: "Reliability", tone: "minor" },
] as const;

export function HomeFindingsPreview(): React.ReactElement {
  const [selected, setSelected] = useState(0);
  return (
    <div className={styles.reviewWindow} aria-label="Illustrative AI review preview">
      <header className={styles.reviewHeader}>
        <span className={styles.reviewIdentity}>
          <LogoMark size="xs" />
          <span><strong>ReviewRouter</strong><small>Illustrative PR review</small></span>
        </span>
        <span className={styles.reviewReady}>
          <Check aria-hidden="true" size={13} /> Review ready
        </span>
      </header>
      <div className={styles.reviewPr}>
        <GitPullRequest aria-hidden="true" size={18} />
        <span><strong>Pull request</strong><small>Review findings</small></span>
        <span className={styles.reviewCount}>03</span>
      </div>
      <div className={styles.reviewSubhead}><span>FINDINGS</span><span>SELECT TO PREVIEW</span></div>
      <div className={styles.reviewFindings} role="group" aria-label="Preview finding severity">
        {findings.map((finding, index) => (
          <button
            key={finding.label}
            type="button"
            aria-pressed={selected === index}
            aria-label={"Preview " + finding.label + " finding"}
            onClick={() => setSelected(index)}
            className={[styles.finding, styles[finding.tone], selected === index ? styles.findingSelected : ""].join(" ")}
          >
            <span className={styles.findingIndex}>0{index + 1}</span>
            <ShieldAlert aria-hidden="true" size={17} />
            <span className={styles.findingName}>{finding.label}</span>
            <span className={styles.findingCategory}>{finding.category}</span>
            <span className={styles.findingDot} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className={styles.reviewFooter}>
        <span className={styles.reviewPulse} aria-hidden="true" />
        <output aria-live="polite">{findings[selected].label} selected / review insight</output>
        <span className={styles.reviewPowered}>OpenCodeReview engine</span>
      </div>
    </div>
  );
}
