// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeHeroVideo, muxPlayerUrl, muxPosterUrl } from "./home-hero-video";

afterEach(() => {
  cleanup();
});

describe("hero video", () => {
  it("builds a hosted Mux player URL with an encoded id and title", () => {
    const url = new URL(muxPlayerUrl("abc/123", "Demo & more"));

    expect(url.origin + url.pathname).toBe("https://player.mux.com/abc%2F123");
    expect(url.searchParams.get("title")).toBe("Demo & more");
    expect(url.searchParams.get("accent-color")).toBe("#7de7ff");
    expect(url.searchParams.has("autoplay")).toBe(false);
    expect(
      new URL(muxPlayerUrl("abc", "Demo", true)).searchParams.get("autoplay"),
    ).toBe("true");
  });

  it("builds a poster thumbnail URL", () => {
    const url = new URL(muxPosterUrl("abc", 480));

    expect(url.origin + url.pathname).toBe(
      "https://image.mux.com/abc/thumbnail.webp",
    );
    expect(url.searchParams.get("width")).toBe("480");
  });

  it("shows the placeholder, not an empty player, until a playback id is set", () => {
    const { container } = render(<HomeHeroVideo />);

    expect(container.textContent).toContain("Video coming soon");
    expect(container.querySelector("iframe")).toBeNull();
  });
});
