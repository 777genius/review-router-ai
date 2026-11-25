import { NextResponse } from "next/server";
import { z } from "zod";
import { codexRuntimeMigrationIdSchema } from "@reviewrouter/features-provider-setup";
import { getPrisma } from "../../../../../src/server/prisma";
import { exchangeConfiguredCodexRuntimeMigration } from "../../../../../src/server/codex-runtime-migration-composition";

export async function POST(request: Request): Promise<NextResponse> {
  const headers = { "Cache-Control": "no-store" };
  try {
    const oidcToken = /^Bearer ([^\s]+)$/u.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!oidcToken || oidcToken.length > 32 * 1024)
      throw new Error("invalid_oidc");
    const body = await request.text();
    if (Buffer.byteLength(body) > 2048) throw new Error("invalid_body");
    const { migrationId } = z
      .object({ migrationId: codexRuntimeMigrationIdSchema })
      .strict()
      .parse(JSON.parse(body));
    const result = await exchangeConfiguredCodexRuntimeMigration({
      prisma: getPrisma(),
      migrationId,
      oidcToken,
    });
    return NextResponse.json(result, { headers });
  } catch {
    // Do not disclose existence, setup capabilities, token details, or upstream responses.
    return NextResponse.json(
      { error: "codex_runtime_migration_unavailable" },
      { status: 403, headers },
    );
  }
}
