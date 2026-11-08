import { describe, expect, it } from "vitest";
import { createProcessOutputRedactor } from "./process-output-redactor";

function output() {
  const chunks: string[] = [];
  const redactor = createProcessOutputRedactor({
    write: (value) => {
      chunks.push(value);
    },
  });
  return { redactor, chunks };
}

describe("Action process-output redaction", () => {
  it("does not expose split bearer and access-token values", () => {
    const { redactor, chunks } = output();
    redactor.write("Bearer se");
    expect(chunks).toEqual([]);
    redactor.write("cretValue\naccess_token: abc");
    redactor.write("defgh\n");
    redactor.finish();

    expect(chunks.join("")).toBe(
      "Bearer [redacted]\naccess_token: [redacted]\n",
    );
    expect(chunks.join("")).not.toContain("cretValue");
    expect(chunks.join("")).not.toContain("defgh");
  });

  it("withholds and discards oversized records without unbounded buffering", () => {
    const { redactor, chunks } = output();
    redactor.write("x".repeat(70 * 1024));
    expect(chunks).toEqual([]);
    redactor.write("Bearer secret\nnext safe line\n");
    redactor.finish();
    expect(chunks.join("")).toBe(
      "[ReviewRouter omitted oversized process log record]\nnext safe line\n",
    );
  });

  it("reassembles split UTF-8 characters and flushes a final partial line once", () => {
    const { redactor, chunks } = output();
    const bytes = Buffer.from("ok 😀\nlast line", "utf8");
    for (const byte of bytes) redactor.write(Buffer.from([byte]));
    redactor.finish();
    redactor.finish();
    redactor.write("ignored after finalization");
    expect(chunks.join("")).toBe("ok 😀\nlast line");
  });
});
