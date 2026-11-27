/** Real setup form DOM integration; the separate Chromium gate remains required. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { act, createElement } from "react";
import type {
  ConnectionBinding,
  ConnectionProfileV3,
} from "@agent-teams/account-gateway/contracts";
import {
  NativeConnectionForm,
  type NativeConnectionSubmission,
} from "../../../apps/web/app/dashboard/native-connection-form";
import { nativeConnectionProfileView } from "../../../apps/web/src/server/native-connection-view";

// JSDOM is an existing pinned test dependency without a TypeScript declaration.
// Keep its runtime boundary structural and limited to the browser objects used.
type DOMModule = {
  JSDOM: new (
    html: string,
    options: { url: string },
  ) => { window: Window & typeof globalThis };
};

export async function submitSetup(input: {
  profile: ConnectionProfileV3;
  selection: ConnectionBinding;
  begin: (submission: NativeConnectionSubmission) => Promise<void>;
}) {
  assert.equal(input.selection.profileId, input.profile.profileId);
  const profile = nativeConnectionProfileView(input.profile);
  const method = profile.connection?.nativeMethods?.find(
    (value) => value.methodId === input.selection.methodId,
  );
  assert.ok(method);
  assert.equal(method.interaction.kind, "browser");
  const { JSDOM } = createRequire(import.meta.url)("jsdom") as DOMModule;
  const dom = new JSDOM("<!doctype html><div id='joined-setup'></div>", {
    url: "http://127.0.0.1/",
  });
  const values: Record<string, unknown> = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    FormData: dom.window.FormData,
    Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const saved = new Map(
    Object.keys(values).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const pending: { count: number; task?: Promise<void> } = { count: 0 };
  let root: import("react-dom/client").Root | undefined;
  try {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, key, {
        configurable: true,
        writable: true,
        value,
      });
    }
    const { createRoot } = await import("react-dom/client");
    const container = dom.window.document.getElementById("joined-setup");
    assert.ok(container);
    root = createRoot(container);
    const mounted = root;
    await act(async () => {
      mounted.render(
        createElement(NativeConnectionForm, {
          profile,
          selection: input.selection,
          disabled: false,
          inline: true,
          begin: (submission) => {
            pending.count++;
            assert.deepEqual(submission.intent.connection, input.selection);
            assert.equal(submission.interaction, "browser");
            assert.deepEqual(submission.inputFields, {});
            pending.task = input.begin(submission);
            // The real component intentionally does not await its event handler.
            // Observe its rejection here, then propagate it through pending.task.
            void pending.task.catch(() => undefined);
            return pending.task;
          },
        }),
      );
    });
    const form = container.querySelector("form");
    const button = container.querySelector<HTMLButtonElement>(
      'button[type="submit"]',
    );
    assert.ok(form && button);
    assert.equal(button.disabled, false);
    assert.ok(button.textContent?.includes(input.profile.provider.label));
    assert.ok(container.textContent?.includes(method.label));
    await act(async () => {
      form.requestSubmit(button);
    });
    assert.equal(
      pending.count,
      1,
      "actual form submit must enter the adapter once",
    );
    assert.ok(pending.task);
    await pending.task;
    return {
      formSubmitted: true as const,
      methodId: method.methodId,
      interaction: method.interaction.kind,
      environment: "dom_integration" as const,
    };
  } finally {
    try {
      if (root) {
        const mounted = root;
        await act(async () => mounted.unmount());
      }
    } finally {
      dom.window.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
}
