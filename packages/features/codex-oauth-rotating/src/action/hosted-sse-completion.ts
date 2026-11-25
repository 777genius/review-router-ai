// Completion authority is a complete Responses terminal frame, not [DONE].
// Keep only one bounded SSE frame; never retain or log the response output.
const maxFrameCharacters = 2_000_000;

export class HostedSseCompletion {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private line = "";
  private data: string[] = [];
  private event = "";
  private characters = 0;
  private afterCr = false;
  private invalid = false;
  private terminal = false;
  private done = false;
  private responseId: string | undefined;

  get completed(): boolean {
    return this.terminal && !this.invalid;
  }

  push(bytes: Uint8Array): void {
    try {
      this.consume(this.decoder.decode(bytes, { stream: true }));
    } catch {
      this.reject();
    }
  }

  finish(): boolean {
    try {
      this.consume(this.decoder.decode());
    } catch {
      this.reject();
    }
    if (this.line || this.data.length || this.event) this.reject();
    return this.completed;
  }

  private reject(): void {
    this.invalid = true;
    this.line = "";
    this.data = [];
    this.event = "";
  }

  private consume(text: string): void {
    for (const character of text) {
      if (this.invalid) return;
      if (this.afterCr && character === "\n") {
        this.afterCr = false;
        continue;
      }
      this.afterCr = character === "\r";
      if (++this.characters > maxFrameCharacters) {
        this.reject();
        return;
      }
      if (character === "\r" || character === "\n") {
        this.consumeLine();
      } else {
        this.line += character;
      }
    }
  }

  private consumeLine(): void {
    const line = this.line;
    this.line = "";
    if (line === "") {
      this.consumeFrame();
      this.characters = 0;
      this.data = [];
      this.event = "";
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const name = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "data") this.data.push(value);
    if (name === "event") this.event = value;
    // Other SSE fields do not grant completion authority.
  }

  private consumeFrame(): void {
    if (!this.data.length) {
      if (this.event) this.reject();
      return;
    }
    const data = this.data.join("\n");
    if (data === "[DONE]") {
      if (!this.completed || this.done || this.event) this.reject();
      this.done = true;
      return;
    }
    if (this.terminal || this.done) {
      this.reject();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(data);
    } catch {
      this.reject();
      return;
    }
    if (
      !record(value) ||
      typeof value.type !== "string" ||
      !value.type ||
      (this.event && this.event !== value.type)
    ) {
      this.reject();
      return;
    }
    if (
      [
        "response.failed",
        "response.incomplete",
        "response.error",
        "error",
      ].includes(value.type)
    ) {
      this.reject();
      return;
    }
    const response = value.response;
    if (record(response) && typeof response.id === "string") {
      if (
        !response.id ||
        (this.responseId !== undefined && response.id !== this.responseId)
      ) {
        this.reject();
        return;
      }
      this.responseId = response.id;
    }
    if (value.type === "response.completed") {
      if (
        !record(response) ||
        typeof response.id !== "string" ||
        !response.id ||
        response.status !== "completed" ||
        response.error != null ||
        response.incomplete_details != null
      ) {
        this.reject();
        return;
      }
      this.terminal = true;
    }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
