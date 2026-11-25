/**
 * Maps every value with at most `limit` mappers running at once and keeps
 * the input order, for bounded fan-out such as GitHub calls per repository.
 * The first rejection rejects the whole map and no further mapper starts;
 * mappers already running finish on their own.
 */
export async function mapWithConcurrency<Value, Mapped>(
  values: readonly Value[],
  limit: number,
  mapper: (value: Value, index: number) => Promise<Mapped>,
): Promise<Mapped[]> {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error("map_with_concurrency_limit_invalid");
  const results = new Array<Mapped>(values.length);
  let nextIndex = 0;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (!failed && nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await mapper(values[index]!, index);
        } catch (error) {
          failed = true;
          throw error;
        }
      }
    }),
  );
  return results;
}
