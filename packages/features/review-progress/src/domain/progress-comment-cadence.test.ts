import { describe, expect, it } from "vitest";
import {
  progressCommentFirstPublishDelayMs,
  progressCommentMinEditIntervalMs,
  progressCommentPublishAt,
} from "./progress-comment-cadence";

const now = new Date("2026-08-12T12:00:00.000Z");
const recent = new Date(now.getTime() - 10_000);
const old = new Date(now.getTime() - progressCommentMinEditIntervalMs - 1);

describe("progressCommentPublishAt", () => {
  it.each([
    ["terminal state", { terminal: true, phaseChanged: false }, recent, now],
    ["phase change", { terminal: false, phaseChanged: true }, recent, now],
    [
      "same-phase update after a recent edit",
      { terminal: false, phaseChanged: false },
      recent,
      new Date(recent.getTime() + progressCommentMinEditIntervalMs),
    ],
    [
      "same-phase update after the interval passed",
      { terminal: false, phaseChanged: false },
      old,
      now,
    ],
    [
      "first comment on the pull request",
      { terminal: false, phaseChanged: true },
      null,
      new Date(now.getTime() + progressCommentFirstPublishDelayMs),
    ],
    [
      "first comment, already terminal",
      { terminal: true, phaseChanged: true },
      null,
      now,
    ],
  ])("schedules a %s", (_name, flags, lastPublishedAt, expected) => {
    expect(
      progressCommentPublishAt({
        now,
        lastPublishedAt,
        pendingPublishAt: null,
        ...flags,
      }),
    ).toEqual(expected);
  });

  it("never pushes back a still unpublished earlier schedule", () => {
    expect(
      progressCommentPublishAt({
        now,
        lastPublishedAt: recent,
        terminal: false,
        phaseChanged: false,
        pendingPublishAt: now,
      }),
    ).toEqual(now);
    const later = new Date(
      now.getTime() + 5 * progressCommentMinEditIntervalMs,
    );
    expect(
      progressCommentPublishAt({
        now,
        lastPublishedAt: recent,
        terminal: false,
        phaseChanged: true,
        pendingPublishAt: later,
      }),
    ).toEqual(now);
  });
});
