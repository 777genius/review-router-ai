import { Play } from "lucide-react";

/**
 * Single place to plug in the hero product video. While `src` is null the
 * slot renders an honest placeholder instead of an empty player.
 */
export const homeHeroVideo: {
  src: string | null;
  poster: string | null;
  title: string;
} = {
  src: null,
  poster: null,
  title: "ReviewRouter product walkthrough",
};

export function HomeHeroVideo(): React.ReactElement {
  const { src, poster, title } = homeHeroVideo;

  return (
    <figure className="rr-home-video" aria-label={title}>
      <div className="rr-home-video__frame">
        {src ? (
          <video
            className="rr-home-video__player"
            controls
            playsInline
            preload="metadata"
            poster={poster ?? undefined}
            aria-label={title}
          >
            <source src={src} />
          </video>
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
