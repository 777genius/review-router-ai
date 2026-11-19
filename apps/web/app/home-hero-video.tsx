"use client";

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Play } from "lucide-react";

/**
 * Single place to plug in the hero product video: set `muxPlaybackId` to the
 * Mux playback id (the `<id>` in https://stream.mux.com/<id>.m3u8). While it
 * is null the slot renders an honest placeholder instead of an empty player.
 */
export const homeHeroVideo: {
  muxPlaybackId: string | null;
  title: string;
} = {
  muxPlaybackId: "qZ98rT00ddnuAwiRU6yhAIA54Ks8hfT00RNJkp5n01MJa8",
  title: "ReviewRouter product walkthrough",
};

const playerColors = {
  accent: "#7de7ff",
  primary: "#ecfbff",
  secondary: "#07111b",
} as const;
const thumbnailTime = 2.5;

export function muxPosterUrl(playbackId: string, width: number): string {
  const url = new URL(
    `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.webp`,
  );
  url.searchParams.set("time", String(thumbnailTime));
  url.searchParams.set("width", String(width));
  url.searchParams.set("fit_mode", "preserve");
  return url.toString();
}

/** The player code loads only when the visitor presses play. */
const MuxPlayer = dynamic(() => import("@mux/mux-player-react"), {
  ssr: false,
});

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

/** Must run inside the click handler: browsers only allow it after a gesture. */
function enterFullscreen(element: FullscreenElement | null): void {
  if (!element) return;
  try {
    const request = element.requestFullscreen
      ? element.requestFullscreen()
      : element.webkitRequestFullscreen?.();
    void Promise.resolve(request).catch(() => undefined);
  } catch {
    // Browsers without element fullscreen (iPhone Safari) play inline.
  }
}

export function HomeHeroVideo(): React.ReactElement {
  const { muxPlaybackId, title } = homeHeroVideo;

  return (
    <figure className="rr-home-video" aria-label={title}>
      {muxPlaybackId ? (
        <VideoFrame playbackId={muxPlaybackId} title={title} />
      ) : (
        <div className="rr-home-video__frame">
          <div className="rr-home-video__placeholder">
            <span className="rr-home-video__play" aria-hidden="true">
              <Play size={30} fill="currentColor" />
            </span>
            <strong>Product walkthrough</strong>
            <small>Video coming soon</small>
          </div>
        </div>
      )}
    </figure>
  );
}

function VideoFrame({
  playbackId,
  title,
}: {
  readonly playbackId: string;
  readonly title: string;
}): React.ReactElement {
  const frame = useRef<HTMLDivElement>(null);
  const [activated, setActivated] = useState(false);

  const start = useCallback((): void => {
    setActivated(true);
    enterFullscreen(frame.current);
  }, []);

  return (
    <div ref={frame} className="rr-home-video__frame" data-active={activated}>
      {activated ? (
        // No `title` prop: the player would draw it over the top-left corner.
        <MuxPlayer
          className="rr-home-video__player"
          playbackId={playbackId}
          streamType="on-demand"
          autoPlay
          accentColor={playerColors.accent}
          primaryColor={playerColors.primary}
          secondaryColor={playerColors.secondary}
          thumbnailTime={thumbnailTime}
          metadata={{ video_title: title, player_name: "Landing hero" }}
        />
      ) : (
        <button
          type="button"
          className="rr-home-video__poster"
          style={
            {
              "--rr-home-video-poster": `url(${muxPosterUrl(playbackId, 1280)})`,
            } as React.CSSProperties
          }
          aria-label={`Play video: ${title}`}
          onClick={start}
        >
          <span className="rr-home-video__play" aria-hidden="true">
            <Play size={44} fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  );
}
