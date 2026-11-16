"use client";

import { useCallback, useEffect, useState } from "react";
import Autoplay from "embla-carousel-autoplay";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
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
  "inline-grid h-10 w-10 place-items-center rounded-full border border-cyan-200/20 bg-slate-950/75 transition hover:border-cyan-200/40 hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200";

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

  // Rotate only while visible, and never for reduced-motion users.
  useEffect(() => {
    if (!emblaApi || !viewport || !("IntersectionObserver" in window)) return;
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const autoplay = emblaApi.plugins().autoplay;
    if (!autoplay) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) autoplay.play();
        else autoplay.stop();
      },
      { threshold: 0.4 },
    );
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      autoplay.stop();
    };
  }, [emblaApi, viewport]);

  // Manual navigation restarts the autoplay timer so a click is never
  // followed by an immediate automatic slide change.
  const resetAutoplay = (): void => {
    emblaApi?.plugins().autoplay?.reset();
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
    emblaApi?.plugins().autoplay?.stop();
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
            <DialogCloseButton label="Close fullscreen screenshot" />
            <img
              key={current.src}
              src={current.src}
              width={current.width}
              height={current.height}
              alt={current.alt}
              draggable={false}
              className="h-auto max-h-[calc(100dvh-8rem)] w-auto max-w-full rounded-xl border border-cyan-200/20 object-contain shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
            />
            <div className="flex items-center gap-4 text-cyan-50">
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
