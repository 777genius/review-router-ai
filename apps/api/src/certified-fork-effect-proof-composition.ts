import {
  captureForkInput,
  type CertifiedForkEffectProofPort,
  type ForkTransaction,
  requireFact,
  sameArchive,
  CertifiedForkHistoryLoader,
  type ForkHistoryReadGuard,
  type ForkHistoryProducers,
  CertifiedForkProofFactWriter,
  type RetainedFactSql,
  parseRetainedFact,
  type AnyRetainedFactInput,
  PrismaCertifiedForkEffectRepository,
  type ForkArchiveOperation,
  type ForkArchiveTransactions,
  type ForkArchiveTrustedHooks,
  type ForkArchiveVersion,
  restoreCertifiedForkCheckpoint,
  historicalForkCommandReference,
  type RestoredForkHistory,
} from "@reviewrouter/features-action-control-plane";

type HistoricalProofs = RestoredForkHistory["proofs"];
type CurrentProofs = Omit<CertifiedForkEffectProofPort, keyof HistoricalProofs>;
type Scope = Awaited<ReturnType<ForkArchiveTrustedHooks["lockScope"]>>;
type Binding = Awaited<ReturnType<Scope["prepareCommand"]>>;
type Command = Omit<ForkTransaction, "build">;

/** Protected infrastructure, never request data. These are deliberately required
 * producer/authorization bindings, not implementations of trust from DTOs.
 * prepareCommand acquires current control guards before returning. assertStorage
 * authenticates the current principal, lease and full admission synchronously at
 * the repository clock, under those guards. run binds the same current proof port
 * once and unbinds in finally, following ForkArchiveTrustedHooks semantics.
 */
export interface CertifiedForkCompositionCurrent {
  readonly proofs: CurrentProofs;
  lockScope(
    sql: RetainedFactSql,
    familyKey: string,
  ): Promise<{
    assertRead: Scope["assertRead"];
    close: Scope["close"];
    prepareCommand(...args: Parameters<Scope["prepareCommand"]>): Promise<{
      run: Binding["run"];
      assertStorage(at: number): void;
      /** Authenticate source custody, original principal, exact command preimage,
       * admission/authority/output causal closure and versions BEFORE returning.
       * Must return the complete atomic fact closure, including the command fact.
       * No caller facts, labels, matching hashes or sealed archive-owner borrowing.
       * Returned facts are staging only; this method must not publish/cache them.
       */
      authenticateRetention(
        version: ForkArchiveVersion,
      ): Promise<readonly AnyRetainedFactInput[]>;
    }>;
  }>;
}

export interface CertifiedForkEffectProofCompositionDependencies {
  /** Dedicated committed-reader lifetime, kept alive through ALL restoration.
   * Never supply an existing write transaction or a connection with staged facts.
   * Current principal/read guards and fixed producer custody are mandatory.
   */
  withCommittedReader<T>(
    work: (sql: RetainedFactSql) => Promise<T>,
  ): Promise<T>;
  assertCurrentRead: ForkHistoryReadGuard;
  producers: ForkHistoryProducers;
  transactions: ForkArchiveTransactions;
  /** Fresh operation-local principal context, with no history/cache promotion. */
  current(history: RestoredForkHistory): CertifiedForkCompositionCurrent;
}

const kinds = [
  "admission",
  "authority",
  "evidence",
  "inventory",
  "output",
  "command",
] as const;
const currentMethods = [
  "issueCheckpoint",
  "ownership",
  "admission",
  "authorize",
  "authority",
  "evidence",
  "inventory",
  "durability",
  "retainedOutput",
  "mutation",
] as const satisfies readonly (keyof CurrentProofs)[];
function method(object: unknown, key: string): void {
  requireFact(
    object !== null &&
      typeof object === "object" &&
      typeof (object as Record<string, unknown>)[key] === "function",
  );
}
function synchronous(work: () => unknown): void {
  // A Promise-returning guard cannot protect synchronous storage, even if typed
  // as void by TypeScript. Require the documented void result.
  requireFact(work() === undefined);
}

/** INTERNAL and unused. No enabled flag, runtime registration, provider gateway,
 * worker or route. Construction performs no I/O. The safe scope is existing,
 * nonempty committed families and raw repository commands built through domain
 * boundaries. Initial admission production and application/use-case wiring are
 * intentionally not supplied. Missing protected bindings fail closed.
 *
 * Each operation cold-restores before entering ANY repository transaction. A
 * changed/rolled-back tip fails; callers may start a fresh operation explicitly.
 * New facts never enter this operation's historical proof set, even after commit.
 * Subsequent operations re-read committed storage (also after lost commit ack).
 */
export function composeCertifiedForkEffectProofs(
  dependencies: CertifiedForkEffectProofCompositionDependencies,
) {
  for (const key of ["withCommittedReader", "assertCurrentRead", "current"])
    method(dependencies, key);
  method(dependencies.transactions, "run");
  for (const kind of kinds) method(dependencies.producers, kind);
  // Snapshot fixed producer bindings rather than exposing a mutable dispatch map.
  const producers: Readonly<ForkHistoryProducers> = Object.freeze({
    admission: dependencies.producers.admission.bind(dependencies.producers),
    authority: dependencies.producers.authority.bind(dependencies.producers),
    evidence: dependencies.producers.evidence.bind(dependencies.producers),
    inventory: dependencies.producers.inventory.bind(dependencies.producers),
    output: dependencies.producers.output.bind(dependencies.producers),
    command: dependencies.producers.command.bind(dependencies.producers),
  });
  const withReader = dependencies.withCommittedReader.bind(dependencies);
  const readGuard = dependencies.assertCurrentRead.bind(dependencies);
  const createCurrent = dependencies.current.bind(dependencies);
  const transactions = {
    run: dependencies.transactions.run.bind(dependencies.transactions),
  };

  async function prepare(familyKey: string) {
    let reader: RetainedFactSql | undefined;
    const history = await withReader(async (sql) => {
      method(sql, "query");
      reader = sql;
      return restoreCertifiedForkCheckpoint(
        new CertifiedForkHistoryLoader(sql, readGuard, producers),
        familyKey,
      );
    });
    const current = createCurrent(history);
    method(current, "lockScope");
    for (const key of currentMethods) method(current.proofs, key);
    const proofs: CertifiedForkEffectProofPort = Object.freeze({
      ...(Object.fromEntries(
        currentMethods.map((key) => [
          key,
          current.proofs[key].bind(current.proofs),
        ]),
      ) as CurrentProofs),
      ...history.proofs,
    });
    const tip = history.versions.at(-1)!.archive;
    const hooks: ForkArchiveTrustedHooks = {
      proofs,
      async authenticateHistory(_sql, versions) {
        // The repository supplies current first, then an optional original receipt.
        // Equality covers committed tip, comparison and all siblings, not just ID.
        requireFact(versions.length > 0 && sameArchive(versions[0], tip));
        for (const version of versions) {
          proofs.verifyLedger(version.snapshot);
          proofs.verifyReceipt(version.receipt, version.snapshot);
          requireFact(
            sameArchive(
              version,
              history.versions.find(
                (v) => v.archive.snapshot.version === version.snapshot.version,
              )?.archive,
            ),
          );
        }
      },
      async lockScope(sql, family) {
        // Identity rejection is defense in depth, not a substitute for custody:
        // two wrappers over the same staged connection are also forbidden by DI.
        requireFact(sql !== reader && family === familyKey);
        const scope = await current.lockScope(sql, family);
        for (const key of ["assertRead", "close", "prepareCommand"])
          method(scope, key);
        return {
          assertRead(at, owner) {
            synchronous(() => scope.assertRead(at, owner));
          },
          close: () => scope.close(),
          async prepareCommand(connection, command, version, operation) {
            const binding = await scope.prepareCommand(
              connection,
              command,
              version,
              operation,
            );
            for (const key of ["run", "assertStorage", "authenticateRetention"])
              method(binding, key);
            return {
              run<T>(at: number, work: () => T): T {
                return binding.run(at, () => {
                  synchronous(() => binding.assertStorage(at));
                  return work();
                });
              },
              async retain(connection, version) {
                requireFact(connection === sql);
                // Authenticate the WHOLE producer batch before the first INSERT.
                const facts = (
                  await binding.authenticateRetention(version)
                ).map(parseRetainedFact);
                const commands = facts.filter((f) => f.kind === "command");
                requireFact(commands.length === 1);
                const retainedCommand = commands[0]!;
                requireFact(
                  retainedCommand.proofId ===
                    historicalForkCommandReference(
                      family,
                      version.snapshot.version,
                      version.receipt.commandId,
                    ) &&
                    retainedCommand.payload.commandId ===
                      version.receipt.commandId &&
                    retainedCommand.payload.commandHash ===
                      version.receipt.commandHash &&
                    retainedCommand.payload.version ===
                      version.snapshot.version &&
                    retainedCommand.payload.operation === version.operation &&
                    retainedCommand.payload.admissionProof ===
                      version.snapshot.admissionProof &&
                    sameArchive(
                      retainedCommand.payload.comparison,
                      command.expected,
                    ),
                );
                for (const fact of facts) {
                  requireFact(
                    fact.scope.familyKey === family &&
                      fact.scope.reviewHash === version.snapshot.reviewHash &&
                      fact.scope.workspaceId ===
                        version.snapshot.seed.facts.workspaceId &&
                      fact.scope.repositoryConnectionId ===
                        version.snapshot.seed.facts.repositoryId,
                  );
                }
                const writer = new CertifiedForkProofFactWriter(connection);
                for (const fact of facts) {
                  // Keep the discriminant/payload relationship through dispatch.
                  switch (fact.kind) {
                    case "admission":
                      await writer.admission(fact);
                      break;
                    case "authority":
                      await writer.authority(fact);
                      break;
                    case "evidence":
                      await writer.evidence(fact);
                      break;
                    case "inventory":
                      await writer.inventory(fact);
                      break;
                    case "output":
                      await writer.output(fact);
                      break;
                    case "command":
                      await writer.command(fact);
                      break;
                  }
                }
              },
            };
          },
        };
      },
      // Intentionally no promotion: only a fresh committed read can authenticate
      // the next operation. This callback does not issue any proof or authority.
      committed() {},
    };
    return {
      proofs,
      repository: new PrismaCertifiedForkEffectRepository(transactions, hooks),
    };
  }
  return Object.freeze({
    async loadReview(familyKey: string, commandId?: string) {
      const { repository } = await prepare(familyKey);
      return repository.loadReview(familyKey, commandId);
    },
    async transact(
      operation: ForkArchiveOperation,
      command: Command,
      build: (
        proofs: CertifiedForkEffectProofPort,
        ...args: Parameters<ForkTransaction["build"]>
      ) => ReturnType<ForkTransaction["build"]>,
    ) {
      requireFact(
        [
          "acquireClaim",
          "renewClaim",
          "releaseClaim",
          "compareAndCommit",
        ].includes(operation),
      );
      requireFact(typeof build === "function");
      const captured = captureForkInput(command);
      const { repository, proofs } = await prepare(captured.familyKey);
      return repository[operation]({
        ...captured,
        build: (snapshot, at) => build(proofs, snapshot, at),
      });
    },
  });
}
