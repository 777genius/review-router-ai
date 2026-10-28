/** Exact arithmetic for the ledger decimal format; never convert money to number. */
export function costUnits(amount: string): bigint {
  const [integer, fraction = ""] = amount.split(".");
  return BigInt(integer!) * 1000000000000n + BigInt(fraction.padEnd(12, "0"));
}
export function decimal(units: bigint): string {
  const i = units / 1000000000000n;
  const f = (units % 1000000000000n)
    .toString()
    .padStart(12, "0")
    .replace(/0+$/, "");
  return f ? `${i}.${f}` : i.toString();
}
