import { expect, it } from "vitest";
import {
  contextToolsDescriptorDigest,
  supportsContextToolsV1,
} from "../domain/context-tools-capability";
it("does not infer parent MCP support from a shared native binary or an old producer", () => {
  expect(supportsContextToolsV1(undefined)).toBe(false);
  expect(supportsContextToolsV1(null)).toBe(false);
  expect(
    supportsContextToolsV1({
      extensionId: "context-tools.v1",
      descriptorDigest: `sha256:${"0".repeat(64)}`,
    }),
  ).toBe(false);
  expect(
    supportsContextToolsV1({
      extensionId: "context-tools.v1",
      descriptorDigest: contextToolsDescriptorDigest,
    }),
  ).toBe(true);
});
