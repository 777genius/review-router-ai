"use client";

import { useEffect, useState } from "react";
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
const thumbnailTime = "2.5";
const mobileQuery = "(max-width: 767px)";

/** Hosted Mux player. Playback id and title are encoded; colours match the landing. */
export function muxPlayerUrl(
  playbackId: string,
  title: string,
  autoplay = false,
): string {
  const url = new URL(
    `https://player.mux.com/${encodeURIComponent(playbackId)}`,
  );
  url.searchParams.set("accent-color", playerColors.accent);
  url.searchParams.set("primary-color", playerColors.primary);
  url.searchParams.set("secondary-color", playerColors.secondary);
  url.searchParams.set("thumbnail-time", thumbnailTime);
  url.searchParams.set("metadata-video-title", title);
  url.searchParams.set("metadata-player-name", "Landing hero");
  url.searchParams.set("title", title);
  if (autoplay) url.searchParams.set("autoplay", "true");
  return url.toString();
}

export function muxPosterUrl(playbackId: string, width: number): string {
  const url = new URL(
    `https://image.mux.com/${encodeURIComponent(playbackId)}/thumbnail.webp`,
  );
  url.searchParams.set("time", thumbnailTime);
  url.searchParams.set("width", String(width));
  url.searchParams.set("fit_mode", "preserve");
  return url.toString();
}

export function HomeHeroVideo(): React.ReactElement {
  const { muxPlaybackId, title } = homeHeroVideo;

  return (
    <figure className="rr-home-video" aria-label={title}>
      <div className="rr-home-video__frame">
        {muxPlaybackId ? (
          <MuxPlayer playbackId={muxPlaybackId} title={title} />
        ) : (
          <div className="rr-home-video__placeholder">
            <span className="rr-home-video__play" aria-hidden="true">
              <Play size={30} fill="currentColor" />
            </span>
            <strong>Product walkthrough</strong>
            <small>Video coming soon</small>
          </div>
        )}
      </div>
    </figure>
  );
}

type Viewport = "unknown" | "mobile" | "desktop";

function MuxPlayer({
  playbackId,
  title,
}: {
  readonly playbackId: string;
  readonly title: string;
}): React.ReactElement {
  const [viewport, setViewport] = useState<Viewport>("unknown");
  const [activated, setActivated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // A desktop player that is already running must survive narrowing the window.
  const [wasDesktop, setWasDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(mobileQuery);
    const sync = (): void => {
      setViewport(query.matches ? "mobile" : "desktop");
      if (!query.matches) setWasDesktop(true);
    };
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  // Phones show a poster first, so no iframe is created until the visitor
  // asks for the video.
  const showPoster = viewport === "mobile" && !activated && !wasDesktop;
  const showPlayer = viewport !== "unknown" && !showPoster && !failed;

  // A cross-origin iframe reports no reliable error, so the skeleton also
  // clears on a timer instead of hanging forever.
  useEffect(() => {
    if (!showPlayer) return;
    setLoaded(false);
    const timer = window.setTimeout(() => setLoaded(true), 2500);
    return () => window.clearTimeout(timer);
  }, [showPlayer]);

  if (failed) {
    return (
      <div className="rr-home-video__placeholder">
        <span className="rr-home-video__play" aria-hidden="true">
          <Play size={30} fill="currentColor" />
        </span>
        <strong>Video unavailable</strong>
        <small>Please try again later</small>
      </div>
    );
  }

  return (
    <>
      {showPlayer ? (
        <iframe
          className="rr-home-video__iframe"
          data-loaded={loaded ? "true" : "false"}
          src={muxPlayerUrl(playbackId, title, activated)}
          title={title}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {showPoster ? (
        <button
          type="button"
          className="rr-home-video__poster"
          style={
            {
              "--rr-home-video-poster": `url(${muxPosterUrl(playbackId, 480)})`,
            } as React.CSSProperties
          }
          aria-label={`Play video: ${title}`}
          onClick={() => setActivated(true)}
        >
          <span className="rr-home-video__play" aria-hidden="true">
            <Play size={30} fill="currentColor" />
          </span>
        </button>
      ) : null}
      {viewport === "unknown" || (showPlayer && !loaded) ? (
        <div className="rr-home-video__skeleton" aria-hidden="true">
          <span className="rr-home-video__spinner" />
        </div>
      ) : null}
    </>
  );
}
