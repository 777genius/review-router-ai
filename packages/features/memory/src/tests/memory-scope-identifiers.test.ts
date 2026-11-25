import { describe, expect, it } from "vitest";
import {
  MemoryKnowledgeError,
  memoryKnowledgeScopeKey,
} from "../domain/memory-knowledge";

describe("memory scope identifier isolation", () => {
  it("rejects controls and line separators in every scope identifier", () => {
    const controls = [
      ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)),
      "\u007f",
      "\u2028",
      "\u2029",
    ];
    for (const character of controls) {
      for (const identifier of [
        character + "scope",
        "scope" + character,
        "sc" + character + "ope",
      ]) {
        expect(() =>
          memoryKnowledgeScopeKey({
            kind: "workspace",
            workspaceId: identifier,
          }),
        ).toThrow(MemoryKnowledgeError);
        expect(() =>
          memoryKnowledgeScopeKey({
            kind: "repository",
            workspaceId: "workspace",
            repositoryId: identifier,
          }),
        ).toThrow(MemoryKnowledgeError);
        expect(() =>
          memoryKnowledgeScopeKey({
            kind: "user_preference",
            workspaceId: "workspace",
            userId: identifier,
          }),
        ).toThrow(MemoryKnowledgeError);
      }
    }
  });
  it("keeps bounded ASCII identifiers and the workspace/repository boundaries", () => {
    const identifier = "a".repeat(160);
    expect(
      memoryKnowledgeScopeKey({ kind: "workspace", workspaceId: identifier }),
    ).toBe(JSON.stringify([identifier, "workspace", ""]));
    expect(
      memoryKnowledgeScopeKey({
        kind: "repository",
        workspaceId: "workspace-1",
        repositoryId: "repo_1",
      }),
    ).toBe(JSON.stringify(["workspace-1", "repository", "repo_1"]));
    for (const workspaceId of [
      "",
      identifier + "a",
      "repo/path",
      "white space",
    ])
      expect(() =>
        memoryKnowledgeScopeKey({ kind: "workspace", workspaceId }),
      ).toThrow(MemoryKnowledgeError);
  });
});
