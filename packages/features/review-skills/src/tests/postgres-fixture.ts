import { Client } from "pg";

/** Keep independent synthetic fixtures from creating relation-level SSI cycles
 * in the same small disposable catalog; concurrency inside each proof stays real. */
export async function claimReviewSkillsPostgresFixture(
  url: string,
): Promise<Client> {
  const target = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    !target.pathname.includes("review_skills_test")
  )
    throw new Error("disposable_skills_loopback_required");
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(
    "SELECT pg_advisory_lock(hashtextextended('review-skills-synthetic-fixtures-v1', 0))",
  );
  return client;
}
