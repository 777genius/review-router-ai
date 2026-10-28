import { describe, expect, it } from "vitest";
import golden from "./fixtures/review-memory-v2.golden.v1.json";
import {
  renderReviewMemoryPrompt,
  reviewMemorySnapshotHash,
  type ReviewMemoryBundle,
} from "./review-memory-wire";

describe("paired Action memory v2 golden contract", () => {
  it("renders and hashes the exact approved mixed-kind Unicode fixture shared with the Action", () => {
    const bundle = golden.bundle as ReviewMemoryBundle;
    expect(renderReviewMemoryPrompt(bundle)).toBe(golden.renderedPrompt);
    expect(reviewMemorySnapshotHash(bundle)).toBe(golden.snapshotHash);
  });
  it("binds changes to scope, revision, source, generation and the exact memory body", () => {
    const bundle = golden.bundle as ReviewMemoryBundle;
    for (const altered of [
      { ...bundle, headSha: "f".repeat(40) },
      { ...bundle, providerGeneration: "changed" },
      { ...bundle, eligibilityEpoch: "changed" },
      {
        ...bundle,
        items: bundle.items.map((item, index) =>
          index === 0 ? { ...item, body: item.body + " changed" } : item,
        ),
      },
    ])
      expect(reviewMemorySnapshotHash(altered)).not.toBe(golden.snapshotHash);
  });
});
