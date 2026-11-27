import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export type ObservedPostgresQuery = {
  readonly sql: string;
  readonly args: readonly unknown[];
  /** Rows crossing the driver boundary before Prisma maps nested results. */
  readonly rows: number;
};

/** Test instrumentation observes the real adapter, including transaction reads. */
export function createObservedPrismaClient(databaseUrl: string) {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: 4,
    options: "-c timezone=UTC",
  });
  const queries: ObservedPostgresQuery[] = [];
  let recording = false;
  function instrument(
    client: Pick<Awaited<ReturnType<PrismaPg["connect"]>>, "queryRaw">,
  ) {
    const queryRaw = client.queryRaw.bind(client);
    client.queryRaw = async (query) => {
      const result = await queryRaw(query);
      if (recording)
        queries.push({
          sql: query.sql,
          args: [...query.args],
          rows: result.rows.length,
        });
      return result;
    };
  }
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const client = await connect();
    instrument(client);
    const startTransaction = client.startTransaction.bind(client);
    client.startTransaction = async (isolationLevel) => {
      const transaction = await startTransaction(isolationLevel);
      instrument(transaction);
      return transaction;
    };
    return client;
  };
  const prisma = new PrismaClient({
    adapter,
    transactionOptions: { timeout: 15_000 },
  });
  return {
    prisma,
    async capture<T>(read: () => Promise<T>) {
      queries.length = 0;
      recording = true;
      try {
        const value = await read();
        return { value, queries: [...queries] };
      } finally {
        recording = false;
      }
    },
  };
}
