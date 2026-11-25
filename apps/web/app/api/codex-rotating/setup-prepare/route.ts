import { NextResponse } from "next/server";
import {
  readBoundedRequestJson,
  RequestBodyTooLargeError,
} from "../../../../src/server/bounded-request-body";
import {
  codexRotatingSetupLedger,
  codexRotatingSetupLedgerHttpError,
} from "../../../../src/server/codex-rotating-setup-ledger";

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await readBoundedRequestJson(request, 1_100_000);
  } catch (error) {
    const tooLarge = error instanceof RequestBodyTooLargeError;
    return NextResponse.json(
      { error: tooLarge ? "request_body_too_large" : "invalid_json" },
      {
        status: tooLarge ? 413 : 400,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  try {
    const result = await codexRotatingSetupLedger.prepare(payload);
    return NextResponse.json(result, {
      status: result.status === "prepared" ? 201 : 200,
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
