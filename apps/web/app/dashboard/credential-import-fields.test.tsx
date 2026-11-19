// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  CredentialImportFields,
  validCredentialImportText,
} from "./credential-import-fields";
afterEach(cleanup);
it("bounds UTF-8 bytes and refuses invalid surrogate input without parsing provider content", () => {
  expect(validCredentialImportText("x".repeat(65536))).toBe(true);
  expect(validCredentialImportText("é".repeat(32768))).toBe(true);
  expect(validCredentialImportText("é".repeat(32769))).toBe(false);
  expect(validCredentialImportText("\ud800")).toBe(false);
  expect(validCredentialImportText("not parsed JSON\nopaque text")).toBe(true);
});
it("does not resurrect a file cleared while its read was pending", async () => {
  let finish!: (text: string) => void;
  const file = new File(["synthetic"], "auth.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  });
  const loading = vi.fn();
  render(<CredentialImportFields method="oauth_auth_json" loading={loading} />);
  const input = screen.getByLabelText(
    "Or choose an auth.json file",
  ) as HTMLInputElement;
  const field = screen.getByLabelText("Codex auth.json") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { files: [file] } });
  expect(loading).toHaveBeenCalledWith(true);
  // The Add dialog clears both controls on owner, close and provider changes.
  Object.defineProperty(input, "files", { configurable: true, value: [] });
  field.value = "";
  finish("synthetic-never-resurrect");
  await waitFor(() => expect(loading).toHaveBeenLastCalledWith(false));
  expect(field.value).toBe("");
});
it("associates file errors with both controls and clears them when text is edited", async () => {
  const file = new File(["synthetic"], "auth.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: () => Promise.reject(new Error("controlled unreadable file")),
  });
  const loading = vi.fn();
  render(<CredentialImportFields method="oauth_auth_json" loading={loading} />);
  const input = screen.getByLabelText("Or choose an auth.json file");
  const field = screen.getByLabelText("Codex auth.json");
  fireEvent.change(input, { target: { files: [file] } });
  const error = await screen.findByRole("alert");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(error.id);
  expect(field.getAttribute("aria-describedby")).toBe(error.id);

  fireEvent.input(field, { target: { value: "synthetic pasted credential" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(input.hasAttribute("aria-invalid")).toBe(false);
  expect(field.hasAttribute("aria-describedby")).toBe(false);
  expect(loading).toHaveBeenLastCalledWith(false);
});
it("does not overwrite manual input when an older file read completes", async () => {
  let finish!: (text: string) => void;
  const file = new File(["synthetic"], "auth.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  });
  const loading = vi.fn();
  render(<CredentialImportFields method="oauth_auth_json" loading={loading} />);
  const input = screen.getByLabelText("Or choose an auth.json file");
  const field = screen.getByLabelText("Codex auth.json") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.input(field, { target: { value: "synthetic manual replacement" } });
  await act(async () => finish("synthetic stale file credential"));
  expect(field.value).toBe("synthetic manual replacement");
  expect(loading).toHaveBeenLastCalledWith(false);
});
