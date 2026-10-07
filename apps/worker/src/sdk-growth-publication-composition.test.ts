import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createSdkGrowthPublicationFeature,
  sdkGrowthPublicationEnabledEnv,
  sdkGrowthPublicationTakeoverEnabledEnv,
} from "./sdk-growth-publication-composition.js";

const nonKeyCredentialFixture = "sdk-growth-publication-test-credential";

describe("SDK growth publication production composition", () => {
  it("is inert with no handler when the matching authority control is disabled", async () => {
    const feature = createSdkGrowthPublicationFeature({
      env: {},
      prisma: {} as PrismaClient,
    });
    expect(feature.enabled).toBe(false);
    expect(feature.handlers).toEqual([]);
    await expect(feature.runMaintenance()).resolves.toEqual({
      linked: 0,
      failed: 0,
    });
  });

  it("fails startup instead of parking enabled effects without App custody", () => {
    expect(() =>
      createSdkGrowthPublicationFeature({
        env: {
          [sdkGrowthPublicationEnabledEnv]: "1",
          [sdkGrowthPublicationTakeoverEnabledEnv]: "1",
        },
        prisma: {} as PrismaClient,
      }),
    ).toThrow("sdk_growth_publication_github_app_credentials_missing");
  });

  it("rejects activation without fenced outbox takeover", () => {
    expect(() =>
      createSdkGrowthPublicationFeature({
        env: { [sdkGrowthPublicationEnabledEnv]: "1" },
        prisma: {} as PrismaClient,
        githubAppId: "123",
        githubPrivateKey: nonKeyCredentialFixture,
      }),
    ).toThrow("sdk_growth_publication_requires_fenced_outbox_takeover");
  });

  it("registers the exact outbox handler when enabled with App custody", () => {
    const feature = createSdkGrowthPublicationFeature({
      env: {
        [sdkGrowthPublicationEnabledEnv]: "1",
        [sdkGrowthPublicationTakeoverEnabledEnv]: "1",
      },
      prisma: {} as PrismaClient,
      githubAppId: "123",
      githubPrivateKey: nonKeyCredentialFixture,
    });
    expect(feature.enabled).toBe(true);
    expect(feature.handlers).toHaveLength(1);
    expect(feature.handlers[0]).toMatchObject({
      type: "sdk_growth.publication_requested",
      version: 1,
    });
  });
});
