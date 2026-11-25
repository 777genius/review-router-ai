import { afterEach, expect, it, vi } from "vitest";
import { warmNextClientScripts } from "./accounts-reference-e2e/src/warm-next-client-scripts.ts";

const origin = "http://127.0.0.1:3001";
const script =
  '<script src="/_next/static/chunks/main.js?v=1&amp;x=2"></script>';
afterEach(() => vi.restoreAllMocks());

it("drains client scripts once, retains the boot deadline and sends no session cookies", async () => {
  const response = new Response("console.log('fixture')");
  const drain = vi.spyOn(response, "arrayBuffer");
  const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  const signal = AbortSignal.timeout(1_000);
  const warmed = new Set<string>();
  await warmNextClientScripts(script + script, origin, signal, warmed);
  await warmNextClientScripts(script, origin, signal, warmed);
  const url = new URL("/_next/static/chunks/main.js?v=1&x=2", origin);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(url, { redirect: "error", signal });
  expect(drain).toHaveBeenCalledOnce();
  expect(warmed).toEqual(new Set([url.href]));
});

it.each([
  '<script src="https://outside.example/_next/static/main.js"></script>',
  '<script src="/api/private"></script>',
  "<main>No client script</main>",
])(
  "rejects missing or out-of-fixture scripts without network entry: %s",
  async (html) => {
    const send = vi.spyOn(globalThis, "fetch");
    const warmed = new Set<string>();
    await expect(
      warmNextClientScripts(html, origin, new AbortController().signal, warmed),
    ).rejects.toThrow(/accounts_reference_e2e_client_script/);
    expect(send).not.toHaveBeenCalled();
    expect(warmed.size).toBe(0);
  },
);

it("does not record failed HTTP responses as warmed", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("not ready", { status: 503 }),
  );
  const warmed = new Set<string>();
  await expect(
    warmNextClientScripts(script, origin, new AbortController().signal, warmed),
  ).rejects.toThrow("accounts_reference_e2e_client_script_unavailable");
  expect(warmed.size).toBe(0);
});

it("propagates interrupted body reads and never records partial assets", async () => {
  const response = new Response("partial");
  const failure = new DOMException("Boot deadline exceeded", "AbortError");
  vi.spyOn(response, "arrayBuffer").mockRejectedValue(failure);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  const warmed = new Set<string>();
  await expect(
    warmNextClientScripts(script, origin, new AbortController().signal, warmed),
  ).rejects.toBe(failure);
  expect(warmed.size).toBe(0);
});
