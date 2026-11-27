import { readBoundedRequestJson } from "../../../../src/server/bounded-request-body";
import { NextResponse } from "next/server";
import {
  codexRotatingSetupLedger,
  codexRotatingSetupLedgerHttpError,
} from "../../../../src/server/codex-rotating-setup-ledger";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const result = await codexRotatingSetupLedger.authorizeAndPutSecret(
      await readBoundedRequestJson(request, 1_100_000),
    );
    return NextResponse.json(result, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const mapped = codexRotatingSetupLedgerHttpError(error);
    return NextResponse.json(
      { error: mapped.error },
      {
        status: mapped.status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
