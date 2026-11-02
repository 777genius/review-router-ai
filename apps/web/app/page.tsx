import type { Metadata } from "next";
import { CompareSection } from "./compare-section";
import { HomeFaq } from "./home-faq";
import { HomeFeatures } from "./home-features";
import { HomeFinalCta } from "./home-final-cta";
import { HomeHero } from "./home-hero";
import {
  getDashboardMutationStatus,
  getDashboardWorkspaceScope,
} from "../src/server/dashboard-mutations";
import { countConnectedGitHubInstallations } from "../src/server/connected-installations";
import { getGitHubAppInstallUrl } from "../src/server/github-app-install-url";
import { reviewRouterGitHubRepoUrl, reviewRouterWebUrl } from "./public-urls";
import {
  createPublicPageMetadata,
  defaultSeoDescription,
  defaultSeoTitle,
  siteName,
} from "./seo";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Free privacy-first AI code review in CI",
  description: defaultSeoDescription,
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
      sameAs: [reviewRouterGitHubRepoUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${reviewRouterWebUrl}/#website`,
      name: siteName,
      url: reviewRouterWebUrl,
      description: defaultSeoDescription,
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
      name: defaultSeoTitle,
      url: reviewRouterWebUrl,
      description: defaultSeoDescription,
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
    <main className="home-shell flex min-h-screen w-full flex-col gap-12 pb-10 md:gap-16 md:pb-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeHero {...ctaContext} />
      <HomeFeatures />
      <CompareSection />
      <HomeFaq />
      <HomeFinalCta {...ctaContext} />
    </main>
  );
}
