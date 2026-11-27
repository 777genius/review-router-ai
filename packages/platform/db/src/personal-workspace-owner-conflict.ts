import { Prisma } from "@prisma/client";

/** The exact, confirmed unique conflict from inserting a personal workspace. */
export function isPersonalWorkspaceOwnerConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002" ||
    error.meta?.modelName !== "Workspace"
  )
    return false;
  const adapter = error.meta.driverAdapterError;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter))
    return false;
  const cause = adapter.cause;
  if (
    !cause ||
    typeof cause !== "object" ||
    !("kind" in cause) ||
    cause.kind !== "UniqueConstraintViolation" ||
    !("originalCode" in cause) ||
    cause.originalCode !== "23505" ||
    !("constraint" in cause)
  )
    return false;
  const constraint = cause.constraint;
  if (
    !constraint ||
    typeof constraint !== "object" ||
    !("fields" in constraint) ||
    !Array.isArray(constraint.fields)
  )
    return false;
  return (
    constraint.fields.length === 1 &&
    (constraint.fields[0] === "personalOwnerUserId" ||
      constraint.fields[0] === '"personalOwnerUserId"')
  );
}
