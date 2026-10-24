/**
 * Maps every value with at most `limit` mappers running at once and keeps
 * the input order, for bounded fan-out such as GitHub calls per repository.
 * The first rejection rejects the whole map; mappers already running finish.
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
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index]!, index);
      }
    }),
  );
  return results;
}
