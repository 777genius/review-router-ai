import { defineContract, type CapabilitiesOf } from "@get-modular/assembly";
import type { PrismaClient } from "@prisma/client";
import type { HistoryReader } from "../application/ports/history-reader.js";
import type { HistoryProjector } from "../application/ports/history-projector.js";
import type { PrismaHistoryWriter } from "../adapters/outbound/prisma-history-writer.js";
/** Transactional host adapter surface; Prisma never enters neutral application ports. */
export type HistoryCapture = {
  readonly register: (
    ...input: Parameters<PrismaHistoryWriter["register"]>
  ) => Promise<void>;
  readonly captureIntent: (
    ...input: Parameters<PrismaHistoryWriter["captureIntent"]>
  ) => Promise<void>;
  readonly captureExecution: (
    ...input: Parameters<PrismaHistoryWriter["captureExecution"]>
  ) => Promise<void>;
  readonly beforeCompletion: (
    ...input: Parameters<PrismaHistoryWriter["beforeCompletion"]>
  ) => Promise<void>;
  readonly captureCompletion: (
    ...input: Parameters<PrismaHistoryWriter["captureCompletion"]>
  ) => Promise<void>;
};
export type HistoryActivation = { readonly activate: () => Promise<Date> };
export const HistoryDatabase = defineContract<PrismaClient>()({
  id: "reviewrouter/history-database",
  revision: 1,
});
export const HistoryReads = defineContract<HistoryReader>()({
  id: "reviewrouter/history-reader",
  revision: 1,
});
export const HistoryProjection = defineContract<HistoryProjector>()({
  id: "reviewrouter/history-projector",
  revision: 1,
});
export const HistoryCaptures = defineContract<HistoryCapture>()({
  id: "reviewrouter/history-capture",
  revision: 1,
});
export const HistoryActivations = defineContract<HistoryActivation>()({
  id: "reviewrouter/history-activation",
  revision: 1,
});
export type HistoryContracts =
  | typeof HistoryDatabase
  | typeof HistoryReads
  | typeof HistoryProjection
  | typeof HistoryCaptures
  | typeof HistoryActivations;
export type HistoryCapabilities = CapabilitiesOf<HistoryContracts>;
export type ReviewHistoryFeature = {
  readonly reader: HistoryReader;
  readonly writer: HistoryCapture;
  readonly projector: HistoryProjector;
  readonly activateCapture: () => Promise<Date>;
};
