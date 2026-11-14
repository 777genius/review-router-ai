#!/usr/bin/env node
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const landing = read("apps/web/app/home-landing.tsx");
const demo = read("apps/web/app/home-review-demo.tsx");
const page = read("apps/web/app/page.tsx");
const cta = read("apps/web/app/home-cta-cluster.tsx");
const nav = read("apps/web/app/primary-nav.tsx");
const layout = read("apps/web/app/layout.tsx");
const security = read("apps/web/app/security/page.tsx");
const guide = read("apps/web/app/getting-started/page.tsx");

const must = (haystack, needle, reason) =>
  assert.ok(haystack.includes(needle), reason);
must(page, "<HomeLanding {...ctaContext} />", "Homepage must render new landing");
must(page, "getDashboardMutationStatus()", "Preserve signed-in install state");
must(page, "countConnectedGitHubInstallations", "Preserve connected dashboard state");
must(page, "application/ld+json", "Preserve structured data");
assert.ok(!page.includes("<CompareSection"), "Large comparison must live on /compare");
for (const src of [nav, layout, security, guide])
  assert.ok(!src.includes('href="/#compare"'), "Old compare anchor must be updated");
must(cta, "showGitLabBeta = true", "Default CTA behavior must remain");
must(landing, "showGitLabBeta={false}", "Disabled GitLab must not compete in hero");
must(landing, 'href="/fair-use"', "Fair-use disclosures must stay reachable");
must(landing, "https://arxiv.org/abs/2608.09290", "Benchmark must link to its source");
must(landing, "Recall was lower", "Benchmark caveat must be visible");
must(landing, "ILLUSTRATIVE INTERFACE", "Preview may not pose as live customer data");
must(landing, "GitLab support is in development", "GitLab state must be truthful");
must(demo, 'aria-pressed={selected === finding.id}', "Findings must be keyboard-focusable native buttons");
for (const severity of ["CRITICAL", "MAJOR", "MINOR", "INFO"])
  must(demo, severity, "Missing severity " + severity);
assert.ok(!landing.includes("href=\"#\""), "No dead CTAs");
console.log("Landing source contracts: PASS");

