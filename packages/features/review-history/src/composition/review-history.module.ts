import { implement } from "@get-modular/assembly";
import { createPrismaHistoryReader } from "../adapters/outbound/prisma-history-reader.js";
import { createPrismaHistoryProjector } from "../adapters/outbound/prisma-history-projector.js";
import {
  createPrismaHistoryWriter,
  activateHistoryCapture,
} from "../adapters/outbound/prisma-history-writer.js";
import { historyDeclaration } from "./review-history.declaration.js";
import {
  HistoryReads,
  HistoryProjection,
  HistoryCaptures,
  HistoryActivations,
  type HistoryCapabilities,
  type HistoryCapture,
  type ReviewHistoryFeature,
} from "./review-history.contracts.js";
export const historyModule = implement<HistoryCapabilities>()(
  historyDeclaration,
  async ({ database }) => {
    const reader = createPrismaHistoryReader(database);
    const projector = createPrismaHistoryProjector(database);
    const adapter = createPrismaHistoryWriter();
    const writer: HistoryCapture = {
      register: (...args) => adapter.register(...args),
      captureIntent: (...args) => adapter.captureIntent(...args),
      captureExecution: (...args) => adapter.captureExecution(...args),
      beforeCompletion: (...args) => adapter.beforeCompletion(...args),
      captureCompletion: (...args) => adapter.captureCompletion(...args),
    };
    const activation = { activate: () => activateHistoryCapture(database) };
    const instance: ReviewHistoryFeature = {
      reader,
      projector,
      writer,
      activateCapture: activation.activate,
    };
    return {
      instance,
      capabilities: {
        [HistoryReads.id]: reader,
        [HistoryProjection.id]: projector,
        [HistoryCaptures.id]: writer,
        [HistoryActivations.id]: activation,
      },
    };
  },
);
