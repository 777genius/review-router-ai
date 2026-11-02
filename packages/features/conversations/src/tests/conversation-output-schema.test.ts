import { expect, it } from "vitest";
import { conversationOutputSchema } from "../application/process-conversation.js";

it("declares primitive string types on every structured-output discriminator without changing the contract", () => {
  const discriminators: { path: string; values: unknown[] }[] = [];
  function visit(value: unknown, path: string): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}/${index}`));
      return;
    }
    const node = value as Record<string, unknown>;
    if ("enum" in node || "const" in node) {
      expect(node.type, path).toBe("string");
      const values = "const" in node ? [node.const] : node.enum;
      expect(Array.isArray(values), path).toBe(true);
      expect(
        (values as unknown[]).every((v) => typeof v === "string"),
        path,
      ).toBe(true);
      discriminators.push({ path, values: [...(values as string[])].sort() });
    }
    if (node.type === "object") {
      expect(node.additionalProperties, path).toBe(false);
      expect(node.required, path).toEqual(
        Object.keys(node.properties as object),
      );
    }
    for (const [key, child] of Object.entries(node))
      visit(child, `${path}/${key}`);
  }
  visit(conversationOutputSchema.schema, "");
  expect(conversationOutputSchema.name).toBe("reviewrouter_conversation_v1");
  expect(discriminators).toEqual([
    {
      path: "/properties/kind",
      values: ["answer", "clarify", "effect_notice", "silent"],
    },
    { path: "/properties/action/anyOf/1/properties/kind", values: ["create"] },
    {
      path: "/properties/action/anyOf/1/properties/knowledgeKind",
      values: ["observation", "rule"],
    },
    { path: "/properties/action/anyOf/2/properties/kind", values: ["create"] },
    {
      path: "/properties/action/anyOf/2/properties/knowledgeKind",
      values: ["exception"],
    },
    { path: "/properties/action/anyOf/3/properties/kind", values: ["update"] },
    {
      path: "/properties/action/anyOf/4/properties/kind",
      values: ["forget", "relearn", "retire"],
    },
  ]);
  expect(conversationOutputSchema.schema.properties.action.anyOf[0]).toEqual({
    type: "null",
  });
});
