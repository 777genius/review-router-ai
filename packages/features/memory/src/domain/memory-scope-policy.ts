export type MemoryScope = "repository" | "workspace" | "user_prefs";

const repoSpecificPattern =
  /\b(?:repo|repository|project|service|migration|prisma|deploy|database|schema|package|src\/|apps\/|packages\/|\.ts|\.tsx|\.env)\b/i;

export function isSafeUserPreferenceBody(body: string): boolean {
  return repoSpecificPattern.test(body) === false;
}
