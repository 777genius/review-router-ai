import { unstable_rethrow } from "next/navigation";
import { NextResponse } from "next/server";
import { historyErrorStatus } from "./review-history";
const headers = { "cache-control": "private, no-store" };
/** A bounded HTTP error contract shared by the three read-only history routes. */
export async function historyResponse(read: () => Promise<unknown>) {
  try {
    return NextResponse.json(await read(), { headers });
  } catch (error) {
    unstable_rethrow(error);
    const status = historyErrorStatus(error);
    return NextResponse.json(
      {
        error:
          status === 401
            ? "history_sign_in_required"
            : status === 403
              ? "history_access_denied"
              : status === 400
                ? "history_invalid_query"
                : "history_unavailable",
      },
      { status, headers },
    );
  }
}
