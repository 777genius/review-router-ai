import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Locator, Page } from "playwright-core";
import type { FlowRun, VisualFlow } from "./flows.js";
import {
  NATIVE_VISIBILITY,
  type NativeVisibilityFixture,
} from "./native-visibility-fixture.js";
import { VISUAL_NATIVE_PROFILE } from "./native-catalog-fixture.js";
import { VISUAL_USERS, VISUAL_WORKSPACES } from "./fixture-contract.js";
import { workspaceRoute } from "./ui.js";

const personal = NATIVE_VISIBILITY.personal;
const organization = NATIVE_VISIBILITY.organization;
const sourceRow = (page: Page, label: string) =>
  page.getByRole("article", { name: label, exact: true });

function observedReads(
  fixture: NativeVisibilityFixture,
  start: number,
  shared = true,
) {
  const reads = fixture.reads().slice(start);
  for (const read of reads) {
    for (const ref of read.accountRefs) {
      const personalAccount = ref === personal.connection.gatewayAccountRef;
      assert.ok(
        personalAccount || ref === organization.connection.gatewayAccountRef,
      );
      const ownerId = personalAccount
        ? VISUAL_USERS.admin.id
        : VISUAL_WORKSPACES.main.id;
      const owner = `${personalAccount ? "rru" : "rrw"}_${createHash("sha256")
        .update(
          `${personalAccount ? "rr-user-owner-v1" : "rr-workspace-owner-v1"}\0${ownerId}`,
        )
        .digest("hex")}`;
      assert.equal(
        read.ownerRef,
        owner,
        "request retains the canonical owner scope",
      );
      if (!personalAccount) assert.equal(read.realm, "management");
      else if (!shared) assert.equal(read.realm, "consumer-control");
      // overview(workspaceId, true) legitimately reads the viewer's personal
      // row through management; the canonical owner panel uses consumer-control.
    }
  }
  return {
    metadataReadAccountRefs: [
      ...new Set(reads.flatMap((read) => read.accountRefs)),
    ].sort(),
    metadataReadRealms: [...new Set(reads.map((read) => read.realm))].sort(),
    metadataReadChannels: [
      ...new Set(
        reads.flatMap((read) =>
          read.accountRefs.map((ref) => `${read.realm}:${ref}`),
        ),
      ),
    ].sort(),
  };
}

async function nativeRow(page: Page, label: string): Promise<Locator> {
  const row = sourceRow(page, label);
  await row.waitFor();
  assert.equal(await row.count(), 1, "one row per canonical native connection");
  await row
    .getByText(
      "New native provider · Cloud identity and subscription · Cloud identity",
      { exact: true },
    )
    .waitFor();
  return row;
}

async function ownerMenu(page: Page, row: Locator, label: string) {
  await row
    .getByRole("button", { name: `Actions for ${label}`, exact: true })
    .click();
  const reconnect = page.getByRole("menuitem", {
    name: "Reconnect",
    exact: true,
  });
  await reconnect.waitFor();
  assert.equal(await reconnect.isEnabled(), true);
  await reconnect.click();
  const dialog = page.getByRole("dialog", {
    name: "Reconnect New native provider",
    exact: true,
  });
  await dialog.getByLabel("Identity secret", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Close connection form" }).click();
}

async function finishPage(flow: FlowRun, page: Page, screenshot: string) {
  await page.waitForLoadState("networkidle");
  await flow.shot(page, screenshot);
  // Keep earlier owners' background reads out of the next actor's evidence.
  await page.close();
}

export async function prepareNativeVisibilityAccounts(prisma: PrismaClient) {
  for (const value of Object.values(NATIVE_VISIBILITY)) {
    await prisma.providerAccountConnection.update({
      where: { id: value.connection.id },
      data: {
        profileRef: VISUAL_NATIVE_PROFILE,
        displayName: value.label,
        // SQL117 requires a new local revision for every account projection.
        metadataRevision: { increment: 1 },
      },
    });
  }
}

export const nativeVisibilityFlow: VisualFlow = {
  id: "flow-native-visibility",
  title:
    "Native account identity and private facts follow ownership across personal and shared workspaces",
  requires: { personalSharing: true },
  run: async (flow) => {
    const fixture = flow.env.nativeVisibility;
    assert.ok(fixture, "native role-visibility HTTP fixture required");
    await prepareNativeVisibilityAccounts(flow.prisma);
    const binding = await flow.prisma.workspaceAccountBinding.findUniqueOrThrow(
      { where: { id: personal.connection.bindingId } },
    );
    const source =
      await flow.prisma.providerAccountConnection.findUniqueOrThrow({
        where: { id: personal.connection.id },
      });
    assert.equal(source.ownerUserId, VISUAL_USERS.admin.id);
    assert.equal(source.ownerWorkspaceId, null);
    assert.equal(binding.state, "active");
    assert.equal(binding.workspaceId, VISUAL_WORKSPACES.main.id);
    assert.equal(source.profileRef, VISUAL_NATIVE_PROFILE);
    fixture.setActive(true);

    await flow.check(
      "personal owner sees native identity, private facts and reconnect only for owned sources",
      async () => {
        const start = fixture.reads().length;
        const page = await flow.open(
          "admin",
          workspaceRoute("adminPersonal", "setup"),
        );
        const row = await nativeRow(page, personal.label);
        await row.getByText(personal.email, { exact: true }).waitFor();
        assert.equal(await sourceRow(page, organization.label).count(), 0);
        await ownerMenu(page, row, personal.label);
        await finishPage(flow, page, "personal-owner");
        const refs = fixture
          .reads()
          .slice(start)
          .flatMap((read) => read.accountRefs);
        assert.ok(refs.includes(personal.connection.gatewayAccountRef));
        assert.equal(
          refs.includes(organization.connection.gatewayAccountRef),
          false,
        );
        return JSON.stringify({
          viewer: "admin",
          workspace: "adminPersonal",
          ...observedReads(fixture, start, false),
        });
      },
    );

    await flow.check(
      "personal owner retains native details and controls in a shared workspace without duplicate rows",
      async () => {
        const start = fixture.reads().length;
        const page = await flow.open("admin", workspaceRoute("main", "setup"));
        const row = await nativeRow(page, personal.label);
        await row.getByText(personal.email, { exact: true }).waitFor();
        await row.getByText("You", { exact: true }).waitFor();
        await row
          .getByText("Used in this workspace", { exact: true })
          .waitFor();
        const orgRow = await nativeRow(page, organization.label);
        await orgRow.getByText(organization.email, { exact: true }).waitFor();
        await ownerMenu(page, row, personal.label);
        await finishPage(flow, page, "owner-shared-workspace");
        const refs = fixture
          .reads()
          .slice(start)
          .flatMap((read) => read.accountRefs);
        assert.ok(refs.includes(personal.connection.gatewayAccountRef));
        assert.ok(refs.includes(organization.connection.gatewayAccountRef));
        return JSON.stringify({
          viewer: "admin",
          workspace: "main",
          ...observedReads(fixture, start),
        });
      },
    );

    await flow.check(
      "recipient workspace owner sees the shared native row but cannot read or reconnect its owner's account",
      async () => {
        const start = fixture.reads().length;
        const page = await flow.open("owner", workspaceRoute("main", "setup"));
        const row = await nativeRow(page, personal.label);
        await row
          .getByText("Limits visible to the owner only", { exact: true })
          .waitFor();
        await row
          .getByText(`@${VISUAL_USERS.admin.login}`, { exact: true })
          .waitFor();
        const orgRow = await nativeRow(page, organization.label);
        await orgRow.getByText(organization.email, { exact: true }).waitFor();
        await row
          .getByRole("button", {
            name: `Actions for ${personal.label}`,
            exact: true,
          })
          .click();
        await page
          .getByRole("menuitem", {
            name: "Remove from this workspace",
            exact: true,
          })
          .waitFor();
        for (const action of await page
          .getByRole("menuitem", {
            name: /^(Reconnect|Rename|Disable|Enable|Remove connection…)$/,
          })
          .all()) {
          assert.equal(
            await action.isEnabled(),
            false,
            "recipient has no canonical write authority",
          );
        }
        assert.equal((await page.content()).includes(personal.email), false);
        await page.keyboard.press("Escape");
        await finishPage(flow, page, "recipient-workspace-owner");
        const refs = fixture
          .reads()
          .slice(start)
          .flatMap((read) => read.accountRefs);
        assert.equal(
          refs.includes(personal.connection.gatewayAccountRef),
          false,
          "borrowed metadata must be denied before HTTP",
        );
        assert.ok(refs.includes(organization.connection.gatewayAccountRef));
        return JSON.stringify({
          viewer: "owner",
          workspace: "main",
          ...observedReads(fixture, start),
        });
      },
    );

    await flow.check(
      "recipient member retains safe native inventory with neither private reads nor account management",
      async () => {
        const start = fixture.reads().length;
        const page = await flow.open("member", workspaceRoute("main", "setup"));
        for (const value of Object.values(NATIVE_VISIBILITY)) {
          const row = await nativeRow(page, value.label);
          await row
            .getByText("Limits visible to the owner only", { exact: true })
            .waitFor();
          assert.equal(
            await row
              .getByRole("button", {
                name: `Actions for ${value.label}`,
                exact: true,
              })
              .count(),
            0,
          );
          assert.equal((await page.content()).includes(value.email), false);
        }
        await finishPage(flow, page, "recipient-member");
        assert.deepEqual(
          fixture.reads().slice(start),
          [],
          "member metadata must be denied before HTTP",
        );
        return JSON.stringify({
          viewer: "member",
          workspace: "main",
          ...observedReads(fixture, start),
        });
      },
    );
    assert.deepEqual(
      flow.env.nativeOperations?.evidence(),
      [],
      "visibility and closed reconnect dialogs must not mutate credentials",
    );
  },
};
