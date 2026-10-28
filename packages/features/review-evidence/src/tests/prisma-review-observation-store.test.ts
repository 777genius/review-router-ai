import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ReviewObservationAcceptPersistenceStatus } from "../application/ports/review-observation-ports";
import {
  ReviewObservationQualityFlag,
  ReviewProviderKind,
} from "../domain/review-evidence-primitives";
import { PrismaReviewObservationStore } from "../infrastructure/prisma/prisma-review-observation-store";
import { observation } from "./fixtures";

describe("Prisma review observation store", () => {
  it("returns a successful insert with every supported quality flag", async () => {
    const qualityFlags = [
      ReviewObservationQualityFlag.ModelFallback,
      ReviewObservationQualityFlag.LowConfidence,
      ReviewObservationQualityFlag.ProviderWarning,
      ReviewObservationQualityFlag.ContextInspectionIncomplete,
      ReviewObservationQualityFlag.ContextAttestationUnavailable,
      ReviewObservationQualityFlag.CrossRevisionReuseDisabled,
    ] as const;
    const create = vi.fn(async ({ data }: { data: unknown }) => data);
    const store = new PrismaReviewObservationStore({
      reviewEvidenceObservation: { create },
    } as unknown as PrismaClient);
    const candidate = observation({ qualityFlags });

    await expect(store.acceptObservation(candidate)).resolves.toMatchObject({
      status: ReviewObservationAcceptPersistenceStatus.Accepted,
      observation: { qualityFlags: candidate.qualityFlags },
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it("rejects inherited object keys as persisted quality flags", async () => {
    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        qualityFlagsJson: ["toString"],
      }),
    );
    const store = new PrismaReviewObservationStore({
      reviewEvidenceObservation: { create },
    } as unknown as PrismaClient);

    await expect(store.acceptObservation(observation())).rejects.toThrow(
      "review_observation_quality_flag_invalid:toString",
    );
  });

  it("round-trips ocr through ReviewProviderKindV2 without touching legacy rows", async () => {
    let row: Record<string, unknown> | null = null;
    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        row = data;
        return data;
      },
    );
    const findUnique = vi.fn(async () => row);
    const store = new PrismaReviewObservationStore({
      reviewEvidenceObservation: { create, findUnique },
    } as unknown as PrismaClient);

    await expect(
      store.acceptObservation(
        observation({ providerKind: ReviewProviderKind.Ocr }),
      ),
    ).resolves.toMatchObject({
      status: ReviewObservationAcceptPersistenceStatus.Accepted,
      observation: { providerKind: ReviewProviderKind.Ocr },
    });
    // Domain ocr persists as the real additive ReviewProviderKindV2 value.
    expect(row).toMatchObject({ providerKind: "ocr" });
    await expect(store.findById("observation-1")).resolves.toMatchObject({
      providerKind: ReviewProviderKind.Ocr,
    });

    // Historical codex rows keep reading back as before.
    row = { ...row!, providerKind: "codex" };
    await expect(store.findById("observation-1")).resolves.toMatchObject({
      providerKind: ReviewProviderKind.Codex,
    });
    row = { ...row!, providerKind: "ocr" };
    await expect(store.findById("observation-1")).resolves.toMatchObject({
      providerKind: ReviewProviderKind.Ocr,
    });
  });
});
