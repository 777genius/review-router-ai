import type { Metadata } from "next";
import { HomeFaq } from "./home-faq";
import { HomeFeatures } from "./home-features";
import { HomeFinalCta } from "./home-final-cta";
import "./home-landing.css";
import { HomeHero } from "./home-hero";
import {
  getDashboardMutationStatus,
  getDashboardWorkspaceScope,
} from "../src/server/dashboard-mutations";
import { countConnectedGitHubInstallations } from "../src/server/connected-installations";
import { getGitHubAppInstallUrl } from "../src/server/github-app-install-url";
import { reviewRouterGitHubRepoUrl, reviewRouterWebUrl } from "./public-urls";
import { createPublicPageMetadata, siteName } from "./seo";

const homeSeoDescription =
  "Open-source AI code review, free to start. Use your own subscription or API key, review in your CI, and see token usage and known costs. Hosted or self-hosted.";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Open-source AI code review | Your model, your budget",
  description: homeSeoDescription,
  path: "/",
});

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${reviewRouterWebUrl}/#organization`,
      name: siteName,
      url: reviewRouterWebUrl,
      logo: `${reviewRouterWebUrl}/review-router-icon.png`,
      sameAs: [
        reviewRouterGitHubRepoUrl,
        "https://github.com/777genius/review-router-ai",
      ],
    },
    {
      "@type": "WebSite",
      "@id": `${reviewRouterWebUrl}/#website`,
      name: siteName,
      url: reviewRouterWebUrl,
      description: homeSeoDescription,
      inLanguage: "en-US",
      publisher: {
        "@id": `${reviewRouterWebUrl}/#organization`,
      },
    },
    {
      "@type": "WebApplication",
      "@id": `${reviewRouterWebUrl}/#free-ci-control-plane`,
      name: "ReviewRouter CI control plane",
      url: reviewRouterWebUrl,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description:
        "Free review setup, policy and status control plane; review execution remains in customer-authorized CI.",
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description:
          "Current CI control-plane access. Provider and CI costs are separate; proposed hosted API plans are not for sale.",
      },
    },
    {
      "@type": "WebPage",
      "@id": `${reviewRouterWebUrl}/#webpage`,
      name: "ReviewRouter | Open-source AI code review",
      url: reviewRouterWebUrl,
      description: homeSeoDescription,
      isPartOf: {
        "@id": `${reviewRouterWebUrl}/#website`,
      },
      about: {
        "@id": `${reviewRouterWebUrl}/#organization`,
      },
      inLanguage: "en-US",
    },
  ],
} as const;

export default async function HomePage(): Promise<React.ReactElement> {
  const appInstallUrl = getGitHubAppInstallUrl();
  const [mutationStatus, workspaceScope] = await Promise.all([
    getDashboardMutationStatus(),
    getDashboardWorkspaceScope(),
  ]);
  const connectedInstallations = mutationStatus.signedIn
    ? await countConnectedGitHubInstallations(workspaceScope)
    : 0;
  const hasConnectedApp = connectedInstallations > 0;
  const githubHref = hasConnectedApp
    ? "/dashboard"
    : (appInstallUrl ?? "/setup");
  const githubLabel = hasConnectedApp ? "Open dashboard" : "Install GitHub App";

  const ctaContext = {
    appInstallUrl,
    hasConnectedApp,
    githubHref,
    githubLabel,
  };

  return (
    <main className="rr-landing flex min-h-screen w-full flex-col pb-10 md:pb-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeHero {...ctaContext} />
      <HomeFeatures />
      <div className="rr-home-faq-wrap rr-home-motion">
        <HomeFaq />
      </div>
      <HomeFinalCta {...ctaContext} />
    </main>
  );
}
