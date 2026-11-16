"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Pause,
  Play,
} from "lucide-react";
import {
  DialogBackdrop,
  DialogCloseButton,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "@reviewrouter/ui";

const slides = [
  {
    src: "/landing/usage.webp",
    width: 2270,
    height: 1474,
    label: "Usage",
    alt: "ReviewRouter Usage page: known tokens, provider requests and review runs with a daily token chart and a breakdown by requested model",
  },
  {
    src: "/landing/statistics.webp",
    width: 2270,
    height: 1474,
    label: "Statistics",
    alt: "ReviewRouter Statistics page: pull requests reviewed, total reviews and issues caught with review activity and issues-by-severity charts",
  },
  {
    src: "/landing/providers.webp",
    width: 2290,
    height: 1474,
    label: "Providers",
    alt: "ReviewRouter provider accounts: Grok, Codex, MiMo, OpenRouter and Kimi Code accounts with limits, status and workspace access",
  },
  {
    src: "/landing/review-comment.webp",
    width: 1442,
    height: 1260,
    label: "Review comment",
    alt: "A ReviewRouter review comment on a GitHub pull request with a review summary, minor findings and file references",
  },
  {
    src: "/landing/repositories.webp",
    width: 2272,
    height: 1362,
    label: "Repositories",
    alt: "ReviewRouter repositories page: searchable repository list with setup status and bulk selection",
  },
] as const;

const lightboxButtonClass =
  "inline-grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/60 text-[#e8fbff] transition hover:border-white/40 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6be5fd]";

export function HomeScreenshotCarousel(): React.ReactElement {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [emblaRef, emblaApi] = useEmblaCarousel(
    { loop: true, align: "center", duration: 28 },
    [
      Autoplay({
        delay: 5000,
        stopOnInteraction: true,
        stopOnMouseEnter: true,
        playOnInit: false,
      }),
    ],
  );
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [autoplayAvailable, setAutoplayAvailable] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Once the visitor takes over (drag, click, pause, viewer) rotation must not
  // restart just because the carousel scrolls back into view.
  const userStopped = useRef(false);

  const attachViewport = useCallback(
    (node: HTMLDivElement | null) => {
      emblaRef(node);
      setViewport(node);
    },
    [emblaRef],
  );

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = (): void => setSelected(emblaApi.selectedScrollSnap());
    onSelect();
    emblaApi.on("select", onSelect).on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect).off("reInit", onSelect);
    };
  }, [emblaApi]);

  // Rotate only while visible, never for reduced-motion users, and never
  // again after the visitor has taken over.
  useEffect(() => {
    if (!emblaApi || !viewport || !("IntersectionObserver" in window)) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const autoplay = emblaApi.plugins().autoplay;
    if (!autoplay) return;
    setAutoplayAvailable(true);
    const onPlay = (): void => setPlaying(true);
    const onStop = (): void => setPlaying(false);
    const onPointerDown = (): void => {
      userStopped.current = true;
    };
    emblaApi
      .on("autoplay:play", onPlay)
      .on("autoplay:stop", onStop)
      .on("pointerDown", onPointerDown);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (!userStopped.current) autoplay.play();
        } else autoplay.stop();
      },
      { threshold: 0.4 },
    );
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      emblaApi
        .off("autoplay:play", onPlay)
        .off("autoplay:stop", onStop)
        .off("pointerDown", onPointerDown);
      autoplay.stop();
    };
  }, [emblaApi, viewport]);

  // Manual navigation hands control to the visitor: rotation stops until they
  // press play again.
  const resetAutoplay = (): void => {
    userStopped.current = true;
    emblaApi?.plugins().autoplay?.stop();
  };
  const toggleAutoplay = (): void => {
    const autoplay = emblaApi?.plugins().autoplay;
    if (!autoplay) return;
    if (autoplay.isPlaying()) {
      userStopped.current = true;
      autoplay.stop();
    } else {
      userStopped.current = false;
      autoplay.play();
    }
  };
  const navigate = (direction: "prev" | "next"): void => {
    if (direction === "prev") emblaApi?.scrollPrev();
    else emblaApi?.scrollNext();
    resetAutoplay();
  };
  const goTo = (index: number): void => {
    emblaApi?.scrollTo(index);
    resetAutoplay();
  };
  // The active slide opens fullscreen; a neighbouring one first scrolls to
  // the centre. Embla swallows the click that ends a drag, so swiping never
  // opens the viewer by accident.
  const activate = (index: number): void => {
    if (index !== selected) {
      goTo(index);
      return;
    }
    resetAutoplay();
    setLightboxOpen(true);
  };
  const onLightboxKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === "ArrowLeft") navigate("prev");
    else if (event.key === "ArrowRight") navigate("next");
  };
  const current = slides[selected] ?? slides[0];

  return (
    <div
      className="rr-home-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label="ReviewRouter dashboard screenshots"
    >
      <div className="rr-home-carousel__stage">
        <div className="rr-home-carousel__viewport" ref={attachViewport}>
          <div className="rr-home-carousel__track">
            {slides.map((slide, index) => (
              <div
                key={slide.src}
                className="rr-home-carousel__slide"
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${slides.length}: ${slide.label}`}
                data-active={index === selected ? "true" : "false"}
              >
                <button
                  type="button"
                  className="rr-home-carousel__frame"
                  onClick={() => activate(index)}
                  aria-label={
                    index === selected
                      ? `Open ${slide.label} screenshot fullscreen`
                      : `Show ${slide.label}`
                  }
                >
                  <img
                    src={slide.src}
                    width={slide.width}
                    height={slide.height}
                    alt={slide.alt}
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    draggable={false}
                  />
                  <span className="rr-home-carousel__expand" aria-hidden="true">
                    <Maximize2 size={16} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="rr-home-carousel__arrow rr-home-carousel__arrow--prev"
          onClick={() => navigate("prev")}
          aria-label="Previous screenshot"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rr-home-carousel__arrow rr-home-carousel__arrow--next"
          onClick={() => navigate("next")}
          aria-label="Next screenshot"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="rr-home-carousel__controls">
        {autoplayAvailable ? (
          <button
            type="button"
            className="rr-home-carousel__toggle"
            onClick={toggleAutoplay}
            aria-label={
              playing ? "Pause screenshot rotation" : "Play screenshot rotation"
            }
          >
            {playing ? (
              <Pause size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
          </button>
        ) : null}
        <div className="rr-home-carousel__dots">
          {slides.map((slide, index) => (
            <button
              key={slide.src}
              type="button"
              className="rr-home-carousel__dot"
              aria-label={`Show ${slide.label}`}
              aria-current={index === selected}
              onClick={() => goTo(index)}
            >
              <span>{slide.label}</span>
            </button>
          ))}
        </div>
      </div>
      <DialogRoot open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogPortal>
          <DialogBackdrop className="bg-black/90 backdrop-blur-md transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <DialogPopup
            className="inset-0 left-0 top-0 flex h-dvh max-h-none w-screen translate-x-0 translate-y-0 flex-col items-center justify-center gap-4 overflow-hidden rounded-none border-0 bg-transparent p-4 shadow-none backdrop-blur-none transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 sm:p-8"
            onKeyDown={onLightboxKeyDown}
            onClick={(event) => {
              if (event.target === event.currentTarget) setLightboxOpen(false);
            }}
          >
            <DialogTitle className="sr-only">{current.label}</DialogTitle>
            <DialogCloseButton
              label="Close fullscreen screenshot"
              className="border-white/20 bg-black/60 text-[#e8fbff] hover:border-white/40 hover:bg-white/10 hover:text-white"
            />
            <img
              key={current.src}
              src={current.src}
              width={current.width}
              height={current.height}
              alt={current.alt}
              draggable={false}
              className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full rounded-xl border border-white/15 object-contain shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
            />
            <div className="flex items-center gap-4 text-[#e8fbff]">
              <button
                type="button"
                className={lightboxButtonClass}
                onClick={() => navigate("prev")}
                aria-label="Previous screenshot"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <span className="min-w-40 text-center font-mono text-xs uppercase tracking-[0.12em]">
                {current.label} · {selected + 1} / {slides.length}
              </span>
              <button
                type="button"
                className={lightboxButtonClass}
                onClick={() => navigate("next")}
                aria-label="Next screenshot"
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
          </DialogPopup>
        </DialogPortal>
      </DialogRoot>
    </div>
  );
}
