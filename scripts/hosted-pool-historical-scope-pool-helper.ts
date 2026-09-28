export async function collectAuthenticatedPoolRows<Row>(
  size: number,
  startTransaction: (arrive: () => Promise<void>) => Promise<Row>,
): Promise<{ rows: Row[]; arrived: number }> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => { release = resolve; });
  const timeout = setTimeout(release, 5_000);
  // Retain every transaction even if one start or identity query fails early.
  const transactions = Array.from({ length: size }, () =>
    Promise.resolve().then(() => startTransaction(async () => {
      if (++arrived === size) release();
      await allArrived;
    })));
  try {
    const rows = await Promise.all(transactions);
    return { rows, arrived };
  } finally {
    release();
    clearTimeout(timeout);
    await Promise.allSettled(transactions);
  }
}
