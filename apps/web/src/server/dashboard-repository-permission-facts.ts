import { z } from "zod";

const permissionFactsSchema = z.object({
  permission: z.enum(["admin", "maintain", "write", "triage", "read", "none"]),
  role_name: z.string().trim().min(1).optional(),
  user: z.object({
    id: z.union([
      z.number().int().positive().refine(Number.isSafeInteger),
      z.string().regex(/^[1-9][0-9]*$/),
    ]),
    login: z.string().trim().min(1),
  }),
});

export function readDashboardRepositoryPermissionFacts(
  response: unknown,
  actor: { readonly githubUserId: string; readonly githubLogin: string },
) {
  const facts = permissionFactsSchema.safeParse(response);
  if (
    !facts.success ||
    String(facts.data.user.id) !== actor.githubUserId ||
    facts.data.user.login.toLowerCase() !== actor.githubLogin.toLowerCase()
  ) {
    throw new Error("repository_mutation_forbidden");
  }
  return facts.data;
}
