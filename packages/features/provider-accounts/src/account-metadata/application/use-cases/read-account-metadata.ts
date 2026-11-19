import type {
  AccountMetadataAuthorization,
  AccountMetadataObservation,
  AccountMetadataRequest,
  AccountMetadataView,
} from "../ports/account-metadata.js";
import type { AccountMetadataReader } from "../ports/account-metadata-reader.js";

type Allowed = Extract<AccountMetadataAuthorization, { status: "allowed" }>;
const hidden = (
  status: "restricted" | "unavailable" | "unknown",
): AccountMetadataView => ({
  status,
  displayToken: "restricted",
});
const sameAuthority = (
  before: Allowed,
  after: AccountMetadataAuthorization | undefined,
) =>
  after?.status === "allowed" &&
  before.displayToken === after.displayToken &&
  before.ownerRef === after.ownerRef &&
  before.accountRef === after.accountRef &&
  before.expectedAuthorizationEpoch === after.expectedAuthorizationEpoch;

/** One bounded page read, followed by one final batch authority observation. */
export async function readAccountMetadata(
  input: AccountMetadataRequest,
  reader: AccountMetadataReader,
): Promise<ReadonlyMap<string, AccountMetadataView>> {
  const ids = [...new Set(input.connectionIds)];
  const output = new Map<string, AccountMetadataView>(
    ids.map((id) => [id, hidden("unavailable")]),
  );
  if (!ids.length) return output;
  // Existing pages are bounded; reject an accidental unbounded aggregate.
  if (ids.length > 200) return output;
  const started = Date.now();
  const controller = new AbortController();
  let readTimer: ReturnType<typeof setTimeout> | undefined;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const unavailable = Symbol("metadata_deadline");
  const within = async <T>(
    work: () => Promise<T>,
    ms: number,
    final = false,
  ): Promise<T | typeof unavailable> => {
    if (ms <= 0) return unavailable;
    return Promise.race([
      Promise.resolve().then(work),
      new Promise<typeof unavailable>((resolve) => {
        const timer = setTimeout(() => resolve(unavailable), ms);
        if (final) finalTimer = timer;
        else readTimer = timer;
      }),
    ]);
  };
  try {
    const before = await within(
      () => input.authorize(ids, started + 2500),
      2500,
    );
    if (readTimer) clearTimeout(readTimer);
    if (before === unavailable) return output;
    const groups = new Map<string, Map<string, Allowed>>();
    for (const id of ids) {
      const authority = before.get(id);
      if (!authority || authority.status !== "allowed") {
        output.set(id, hidden(authority?.status ?? "restricted"));
        continue;
      }
      let group = groups.get(authority.ownerRef);
      if (!group) groups.set(authority.ownerRef, (group = new Map()));
      group.set(authority.accountRef, authority);
    }
    const batches: Array<{ owner: string; refs: string[] }> = [];
    for (const [owner, group] of groups) {
      const refs = [...group.keys()];
      for (let offset = 0; offset < refs.length; offset += 50)
        batches.push({ owner, refs: refs.slice(offset, offset + 50) });
    }
    const observed = new Map<string, AccountMetadataObservation>();
    let next = 0;
    const worker = async () => {
      while (!closed && next < batches.length && Date.now() - started < 2500) {
        const batch = batches[next++]!;
        try {
          const values = await reader.read(
            batch.owner,
            batch.refs,
            controller.signal,
          );
          if (closed) return;
          // The SDK enforces this too; injected adapters must preserve identity.
          if (
            values.length !== batch.refs.length ||
            values.some(
              (value, index) => value.accountRef !== batch.refs[index],
            )
          )
            continue;
          for (const value of values)
            observed.set(`${batch.owner}\0${value.accountRef}`, value);
        } catch {
          // Optional facts never replace inventory with a transport failure.
        }
      }
    };
    await within(
      () =>
        Promise.all(
          Array.from({ length: Math.min(4, batches.length) }, worker),
        ),
      2500 - (Date.now() - started),
    );
    closed = true;
    controller.abort();
    if (readTimer) clearTimeout(readTimer);
    const after = await within(
      () => input.authorize(ids, started + 3000),
      3000 - (Date.now() - started),
      true,
    );
    if (after === unavailable)
      return new Map(ids.map((id) => [id, hidden("restricted")]));
    for (const id of ids) {
      const authority = before.get(id);
      if (authority?.status !== "allowed") continue;
      if (!sameAuthority(authority, after.get(id))) {
        output.set(id, hidden("restricted"));
        continue;
      }
      const value = observed.get(
        `${authority.ownerRef}\0${authority.accountRef}`,
      );
      if (
        !value ||
        value.authorizationEpoch !== authority.expectedAuthorizationEpoch
      )
        continue;
      output.set(
        id,
        value.info.status === "available"
          ? {
              status: "available",
              displayToken: authority.displayToken,
              fields: value.info.fields,
            }
          : { status: value.info.status, displayToken: authority.displayToken },
      );
    }
    return output;
  } catch {
    return new Map(ids.map((id) => [id, hidden("restricted")]));
  } finally {
    closed = true;
    controller.abort();
    if (readTimer) clearTimeout(readTimer);
    if (finalTimer) clearTimeout(finalTimer);
  }
}
