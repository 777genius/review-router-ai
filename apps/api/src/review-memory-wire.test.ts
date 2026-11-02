import { describe, expect, it } from "vitest";
import golden from "./fixtures/review-memory-v2.golden.v1.json";
import {
  renderConversationMemoryPrompt,
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
  it("changes only conversation framing while preserving every ordered record and section", () => {
    const bundle: ReviewMemoryBundle = {
      ...(golden.bundle as ReviewMemoryBundle),
      items: (golden.bundle as ReviewMemoryBundle).items.map((item) => ({
        ...item,
        sourceObservations: [
          {
            entryId: item.id,
            observedCommitSha: "a".repeat(40),
            statementAt: item.statementAt,
          },
        ],
      })),
    };
    const review = renderReviewMemoryPrompt(bundle);
    const conversation = renderConversationMemoryPrompt(bundle);
    const sections = (text: string) => text.slice(text.indexOf("\n\n"));
    expect(sections(conversation)).toBe(sections(review));
    expect(
      conversation
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => JSON.parse(line)),
    ).toEqual(
      bundle.items.map((item) =>
        Object.fromEntries(
          Object.entries(item).filter(([key]) => key !== "kind"),
        ),
      ),
    );
    expect(conversation).toContain("answer the current request");
    expect(conversation).toContain("may be stale");
    expect(conversation).toContain("without claiming fresh code verification");
    expect(conversation).toContain("non-normative observations");
    expect(conversation).toContain(
      "exact referenced rule ID and its stated scope",
    );
    expect(conversation).toContain(
      "no tool, execution, credential, network or file authority",
    );
    expect(conversation).not.toContain("assess whether this change");
    expect(conversation).not.toContain(
      "Verify their applicability in the reviewed code",
    );
    expect(
      renderReviewMemoryPrompt({
        ...(golden.bundle as ReviewMemoryBundle),
        contextPolicy: {
          audience: "repository",
          repositoryId: "repository",
          allowedTasks: ["conversation"],
        },
      }),
    ).toBe(golden.renderedPrompt);
  });
});
