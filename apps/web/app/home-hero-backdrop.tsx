"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// WebGL background: keep it out of the server render and the critical bundle.
const AcidSquares = dynamic(() => import("./vendor/react-bits/acid-squares"), {
  ssr: false,
});

function readLightTheme(): boolean {
  return document.documentElement.dataset.theme === "light";
}

export function HomeHeroBackdrop(): React.ReactElement {
  const [lightMode, setLightMode] = useState(false);

  useEffect(() => {
    setLightMode(readLightTheme());
    const observer = new MutationObserver(() => setLightMode(readLightTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div aria-hidden="true" className="rr-home-hero__squares">
      <AcidSquares
        color={lightMode ? "#e6f3f7" : "#08121c"}
        accentColor={lightMode ? "#12a3c9" : "#4fd8f5"}
        secondaryColor={lightMode ? "#8fbf3f" : "#c9ff7d"}
        lightMode={lightMode}
        tileSize={1.4}
        zoom={1.7}
        tilt={0.55}
        speed={0.45}
        opacity={lightMode ? 0.5 : 0.6}
        grain={0.08}
        fade={0}
        pulseOnClick={false}
      />
    </div>
  );
}
