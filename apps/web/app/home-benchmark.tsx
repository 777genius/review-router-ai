"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { HomeCountUp, type HomeMotionPhase } from "./home-count-up";
import { openCodeReviewRepoUrl } from "./public-urls";

const metrics = [
  {
    key: "speed",
    tone: "cyan",
    value: 9.5,
    label: "Faster",
    ocr: "1:23",
    agent: "13:06",
    ocrShare: 10.56,
    delayMs: 0,
  },
  {
    key: "tokens",
    tone: "lime",
    value: 14.7,
    label: "Fewer tokens",
    ocr: "385K",
    agent: "5,664K",
    ocrShare: 6.8,
    delayMs: 350,
  },
] as const;

export function HomeBenchmark(): React.ReactElement {
  const [phase, setPhase] = useState<HomeMotionPhase>("static");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!root || !("IntersectionObserver" in window)) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;

    setPhase("armed");
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setPhase("playing");
      },
      { threshold: 0.4 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);

  return (
    <div className="rr-home-benchmark" data-phase={phase} ref={setRoot}>
      <p className="rr-home-benchmark__context">
        Same model · Upstream AACR-Bench
      </p>
      <div className="rr-home-benchmark__grid">
        {metrics.map((metric) => (
          <div
            key={metric.key}
            className="rr-home-benchmark__metric"
            data-tone={metric.tone}
            style={
              { "--rr-delay": `${metric.delayMs}ms` } as React.CSSProperties
            }
          >
            <div className="rr-home-benchmark__value">
              <HomeCountUp
                value={metric.value}
                decimals={1}
                suffix="×"
                phase={phase}
                delayMs={metric.delayMs}
              />
            </div>
            <strong>{metric.label}</strong>
            <div className="rr-home-benchmark__row">
              <span>OpenCodeReview</span>
              <b>{metric.ocr}</b>
            </div>
            <i className="rr-home-benchmark__track">
              <b
                className="rr-home-benchmark__fill rr-home-benchmark__fill--ocr"
                style={{ width: `${metric.ocrShare}%` }}
              />
            </i>
            <div className="rr-home-benchmark__row">
              <span>
                <img
                  src="/landing/claude.svg"
                  alt=""
                  width={22}
                  height={22}
                  aria-hidden="true"
                />
                Claude Code
              </span>
              <b className="rr-home-benchmark__bad">{metric.agent}</b>
            </div>
            <i className="rr-home-benchmark__track">
              <b className="rr-home-benchmark__fill rr-home-benchmark__fill--agent" />
            </i>
          </div>
        ))}
      </div>
      <p className="rr-home-benchmark__caption">
        Bar lengths are proportional to the upstream results (not billing or
        runtime telemetry).
      </p>
      <p className="rr-home-benchmark__note">
        <a
          href={`${openCodeReviewRepoUrl}#benchmark`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Alibaba upstream benchmark{" "}
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        <span>
          These are engine results under specified test conditions, not
          independently measured ReviewRouter service speed or guaranteed bill
          savings. Review quality and recall vary.
        </span>
      </p>
    </div>
  );
}
