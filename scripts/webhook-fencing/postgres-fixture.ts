import type { Pool, PoolConfig } from "pg";
export const webhookFenceDatabaseName = "rr_webhook_fence_test";
export function webhookFencePostgresConfig(
  environment: NodeJS.ProcessEnv = process.env,
): { enabled: boolean; connection: PoolConfig } {
  const value = environment.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_DATABASE_URL;
  const socket = environment.REVIEW_ROUTER_WEBHOOK_FENCE_TEST_SOCKET;
  if (value) {
    const url = new URL(value);
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.pathname !== `/${webhookFenceDatabaseName}` ||
      [...url.searchParams.keys()].some((key) => key !== "schema")
    )
      throw new Error("webhook_fence_disposable_database_url_required");
    return { enabled: true, connection: { connectionString: value } };
  }
  if (socket && !socket.startsWith("/"))
    throw new Error("webhook_fence_absolute_test_socket_required");
  return {
    enabled: Boolean(socket),
    connection: {
      host: socket ?? "127.0.0.1",
      user: "postgres",
      database: webhookFenceDatabaseName,
    },
  };
}
export const webhookFencePostgres = webhookFencePostgresConfig();
export async function assertWebhookFenceTestDatabase(pool: Pool) {
  if (
    !webhookFencePostgres.enabled ||
    (await pool.query("SELECT current_database() AS name")).rows[0]?.name !==
      webhookFenceDatabaseName
  )
    throw new Error("disposable_test_database_required");
}
