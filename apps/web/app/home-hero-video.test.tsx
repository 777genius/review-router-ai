// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeHeroVideo, homeHeroVideo, muxPosterUrl } from "./home-hero-video";

const playerProps = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
}));

vi.mock("@mux/mux-player-react", () => ({
  default: (props: Record<string, unknown>) => {
    playerProps.current = props;
    return <div data-testid="mux-player" />;
  },
}));

afterEach(() => {
  cleanup();
  playerProps.current = null;
  vi.restoreAllMocks();
});

describe("hero video", () => {
  it("builds a poster thumbnail URL", () => {
    const url = new URL(muxPosterUrl("abc", 480));

    expect(url.origin + url.pathname).toBe(
      "https://image.mux.com/abc/thumbnail.webp",
    );
    expect(url.searchParams.get("width")).toBe("480");
  });

  it("shows the placeholder, not an empty player, when no playback id is set", () => {
    const original = homeHeroVideo.muxPlaybackId;
    homeHeroVideo.muxPlaybackId = null;
    try {
      const { container } = render(<HomeHeroVideo />);

      expect(container.textContent).toContain("Video coming soon");
      expect(screen.queryByRole("button")).toBeNull();
    } finally {
      homeHeroVideo.muxPlaybackId = original;
    }
  });

  it("is wired to a real Mux playback id", () => {
    expect(homeHeroVideo.muxPlaybackId).toMatch(/^[A-Za-z0-9]{20,}$/);
  });

  it("loads no player until play is pressed", () => {
    render(<HomeHeroVideo />);

    expect(screen.getByRole("button", { name: /play video/i })).toBeTruthy();
    expect(screen.queryByTestId("mux-player")).toBeNull();
  });

  it("goes fullscreen on play and starts a player without an on-screen title", async () => {
    const fullscreen = vi.fn().mockResolvedValue(undefined);
    HTMLElement.prototype.requestFullscreen = fullscreen;
    const { container } = render(<HomeHeroVideo />);

    fireEvent.click(screen.getByRole("button", { name: /play video/i }));

    expect(fullscreen).toHaveBeenCalledTimes(1);
    expect(fullscreen.mock.contexts[0]).toBe(
      container.querySelector(".rr-home-video__frame"),
    );
    await screen.findByTestId("mux-player");
    expect(playerProps.current).toMatchObject({
      playbackId: homeHeroVideo.muxPlaybackId,
      autoPlay: true,
    });
    // The player draws `title` in its top-left corner, so it must stay unset.
    expect(playerProps.current).not.toHaveProperty("title");
  });
});
