// Server-only construction. The host owns the borrowed database and worker loop.
import { required } from "@get-modular/core";
import {
  assemblyFor,
  declareModule,
  defineContract,
  implement,
  type CapabilitiesOf,
} from "@get-modular/assembly";
import type { PrismaClient } from "@prisma/client";
import type {
  ReviewStatisticsProjector,
  ReviewStatisticsReader,
} from "../application/ports";
import { PrismaReviewStatisticsReader } from "../infrastructure/prisma-statistics-reader";
import { PrismaReviewStatisticsProjector } from "../infrastructure/prisma-statistics-projector";
import {
  activateReviewStatisticsCapture,
  PrismaReviewStatisticsOutboxWriter,
} from "../infrastructure/prisma-statistics-outbox";

type CaptureActivation = () => ReturnType<
  typeof activateReviewStatisticsCapture
>;
const Database = defineContract<PrismaClient>()({
  id: "reviewrouter/statistics-database",
  revision: 1,
});
const Reader = defineContract<ReviewStatisticsReader>()({
  id: "reviewrouter/statistics-reader",
  revision: 1,
});
const Projector = defineContract<ReviewStatisticsProjector>()({
  id: "reviewrouter/statistics-projector",
  revision: 1,
});
const OutboxWriter = defineContract<PrismaReviewStatisticsOutboxWriter>()({
  id: "reviewrouter/statistics-outbox-writer",
  revision: 1,
});
const Activation = defineContract<CaptureActivation>()({
  id: "reviewrouter/statistics-capture-activation",
  revision: 1,
});
/** Host-only contracts. Prisma and activation never enter application ports. */
export const reviewStatisticsContracts = {
  Database,
  Reader,
  Projector,
  OutboxWriter,
  Activation,
} as const;
type StatisticsCapabilities = CapabilitiesOf<
  | typeof Database
  | typeof Reader
  | typeof Projector
  | typeof OutboxWriter
  | typeof Activation
>;
const owner = { authority: "reviewrouter", path: ["statistics"] } as const;
const hostDeclaration = declareModule({
  moduleId: "reviewrouter/statistics-host",
  implementationId: "reviewrouter/statistics-host/borrowed",
  owner,
  provides: [Database.provide()],
  slots: [],
});
const infrastructureDeclaration = declareModule({
  moduleId: "reviewrouter/statistics-adapters",
  implementationId: "reviewrouter/statistics-adapters/prisma",
  owner,
  provides: [
    Reader.provide(),
    Projector.provide(),
    OutboxWriter.provide(),
    Activation.provide(),
  ],
  slots: [Database.slot("database", required())],
});
const featureDeclaration = declareModule({
  moduleId: "reviewrouter/review-statistics",
  implementationId: "reviewrouter/review-statistics/default",
  owner,
  provides: [],
  slots: [
    Reader.slot("reader", required()),
    Projector.slot("projector", required()),
    OutboxWriter.slot("outbox", required()),
    Activation.slot("activation", required()),
  ],
});
export type ReviewStatisticsFeature = {
  readonly reader: ReviewStatisticsReader;
  readonly projector: ReviewStatisticsProjector;
  readonly outboxWriter: PrismaReviewStatisticsOutboxWriter;
  readonly activateCapture: CaptureActivation;
};
/** Construction only: activation is a separate completion-host action. */
export async function createReviewStatisticsFeature(input: {
  readonly prisma: PrismaClient;
}): Promise<ReviewStatisticsFeature> {
  if (!input.prisma || typeof input.prisma.$transaction !== "function")
    throw new Error("statistics_database_binding_invalid");
  const host = implement<StatisticsCapabilities>()(
    hostDeclaration,
    async () => ({
      instance: input.prisma,
      capabilities: { [Database.id]: input.prisma },
    }),
  );
  const adapters = implement<StatisticsCapabilities>()(
    infrastructureDeclaration,
    async (dependencies) => {
      const reader = new PrismaReviewStatisticsReader(dependencies.database);
      const projector = new PrismaReviewStatisticsProjector(
        dependencies.database,
      );
      const outboxWriter = new PrismaReviewStatisticsOutboxWriter();
      const activateCapture = () =>
        activateReviewStatisticsCapture(dependencies.database);
      return {
        instance: { reader, projector, outboxWriter, activateCapture },
        capabilities: {
          [Reader.id]: reader,
          [Projector.id]: projector,
          [OutboxWriter.id]: outboxWriter,
          [Activation.id]: activateCapture,
        },
      };
    },
  );
  const feature = implement<StatisticsCapabilities>()(
    featureDeclaration,
    async (dependencies) => ({
      instance: {
        reader: dependencies.reader,
        projector: dependencies.projector,
        outboxWriter: dependencies.outbox,
        activateCapture: dependencies.activation,
      },
      capabilities: {},
    }),
  );
  const preparation = await assemblyFor<StatisticsCapabilities>().prepare({
    profileId: "reviewrouter/statistics",
    modules: [host, adapters, feature],
    roots: { statistics: feature },
    bindings: [],
  });
  if (preparation.status !== "prepared")
    throw new Error(`statistics_composition_${preparation.error.code}`, {
      cause: preparation,
    });
  const outcome = await preparation.prepared.run();
  if (outcome.status !== "succeeded")
    throw new Error("statistics_composition_failed");
  return outcome.roots.statistics;
}
