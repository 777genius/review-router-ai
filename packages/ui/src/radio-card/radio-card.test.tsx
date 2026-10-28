// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { RadioCard, RadioCardGroup } from "./radio-card";

afterEach(cleanup);

describe("RadioCard", () => {
  it("names a choice by its title and describes it by its badges, description or disabled reason", () => {
    render(
      <RadioCardGroup label="Provider" value="team" onValueChange={() => {}}>
        <RadioCard
          value="team"
          title="Team Claude"
          description="Claude Code subscription · opus"
          meta={<span>Default</span>}
        />
        <RadioCard
          value="personal"
          title="Personal Codex"
          description="Connected account · gpt-5.5"
          meta={<span>In use</span>}
          disabled
          disabledReason="Only an owner or admin can use it here."
        />
      </RadioCardGroup>,
    );
    expect(
      screen.getByRole("radio", {
        name: "Team Claude",
        description: "Default Claude Code subscription · opus",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", {
        name: "Personal Codex",
        description: "In use Only an owner or admin can use it here.",
      }),
    ).toBeTruthy();
  });
});
