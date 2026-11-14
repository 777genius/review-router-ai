import type { Metadata } from "next";
import { HomeLanding } from "./home-landing";
import {
  getDashboardMutationStatus,
  getDashboardWorkspaceScope,
} from "../src/server/dashboard-mutations";
import { countConnectedGitHubInstallations } from "../src/server/connected-installations";
import { getGitHubAppInstallUrl } from "../src/server/github-app-install-url";
import { reviewRouterGitHubRepoUrl, reviewRouterWebUrl } from "./public-urls";
import {
  createPublicPageMetadata,
  defaultSeoTitle,
  siteName,
} from "./seo";

const landingDescription =
  "Free open-source AI code review platform powered by OpenCodeReview. Bring supported AI subscriptions or API keys, see known tokens and costs, and choose hosted or self-hosted.";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Open-source AI code review with your own models",
  description: landingDescription,
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
      description: landingDescription,
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
      name: "Open-source AI code review with your own models",
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
    <main className="home-shell min-h-screen w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <HomeLanding {...ctaContext} />
    </main>
  );
}
