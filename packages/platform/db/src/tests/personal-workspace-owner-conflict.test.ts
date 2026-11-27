import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isPersonalWorkspaceOwnerConflict } from "../personal-workspace-owner-conflict";
const error = (modelName: string, fields: string[]) =>
  new Prisma.PrismaClientKnownRequestError("synthetic", {
    code: "P2002",
    clientVersion: "7.9.0",
    meta: {
      modelName,
      driverAdapterError: {
        cause: {
          kind: "UniqueConstraintViolation",
          originalCode: "23505",
          constraint: { fields },
        },
      },
    },
  });
describe("personal workspace owner unique conflict", () => {
  it("matches only the confirmed Workspace owner unique constraint", () => {
    expect(
      isPersonalWorkspaceOwnerConflict(
        error("Workspace", ['"personalOwnerUserId"']),
      ),
    ).toBe(true);
    expect(
      isPersonalWorkspaceOwnerConflict(
        error("Workspace", ["personalOwnerUserId"]),
      ),
    ).toBe(true);
    expect(isPersonalWorkspaceOwnerConflict(error("Workspace", ["slug"]))).toBe(
      false,
    );
    expect(
      isPersonalWorkspaceOwnerConflict(
        error("WorkspaceMember", ["personalOwnerUserId"]),
      ),
    ).toBe(false);
    expect(isPersonalWorkspaceOwnerConflict(new Error("network"))).toBe(false);
  });
});
