import { describe, expect, it, vi } from "vitest";
import {
  readReviewProgressSettings,
  reviewProgressEnv,
} from "./review-progress-settings";

describe("readReviewProgressSettings", () => {
  it("turns everything on for every repository when nothing is set", () => {
    for (const env of [
      {},
      {
        [reviewProgressEnv.projectionCapture]: "",
        [reviewProgressEnv.fileCoverage]: " ",
        [reviewProgressEnv.hostedCommentWrites]: "",
        [reviewProgressEnv.repositories]: "",
      },
    ]) {
      expect(readReviewProgressSettings(env)).toEqual({
        projectionCapture: true,
        fileCoverage: true,
        hostedCommentWrites: { allowedRepositoryFullNames: null },
        invalidKeys: [],
      });
    }
  });

  it("treats 0 as an explicit opt-out and the writes key as the kill switch", () => {
    const settings = readReviewProgressSettings({
      [reviewProgressEnv.projectionCapture]: "0",
      [reviewProgressEnv.fileCoverage]: "0",
      [reviewProgressEnv.hostedCommentWrites]: "0",
      [reviewProgressEnv.repositories]: "acme/rocket",
    });
    expect(settings).toMatchObject({
      projectionCapture: false,
      fileCoverage: false,
      hostedCommentWrites: null,
      invalidKeys: [],
    });
  });

  it("keeps an optional case-insensitive owner/repo allow-list", () => {
    const settings = readReviewProgressSettings({
      [reviewProgressEnv.repositories]: " Acme/Rocket , acme/web.site ",
    });
    expect([
      ...(settings.hostedCommentWrites?.allowedRepositoryFullNames ?? []),
    ]).toEqual(["acme/rocket", "acme/web.site"]);
  });

  it.each([
    [reviewProgressEnv.projectionCapture, "true"],
    [reviewProgressEnv.fileCoverage, "yes"],
    [reviewProgressEnv.hostedCommentWrites, "on"],
    [reviewProgressEnv.repositories, "*"],
    [reviewProgressEnv.repositories, "acme/rocket,,acme/web"],
    [reviewProgressEnv.repositories, "acme"],
  ])("fails closed and warns by key name for %s=%s", (key, value) => {
    const warn = vi.fn();
    const settings = readReviewProgressSettings({ [key]: value }, { warn });
    expect(settings.invalidKeys).toEqual([key]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(value);
    if (key === reviewProgressEnv.projectionCapture) {
      expect(settings.projectionCapture).toBe(false);
    } else if (key === reviewProgressEnv.fileCoverage) {
      expect(settings.fileCoverage).toBe(false);
    } else {
      expect(settings.hostedCommentWrites).toBeNull();
    }
  });
});
