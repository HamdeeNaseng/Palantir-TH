"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { IconMaximize, IconX } from "@tabler/icons-react";
import type { MapRef } from "react-map-gl/maplibre";

/**
 * Full-screen for a map panel.
 *
 * Not the browser Fullscreen API: every map here draws React children —
 * popups, legends, the playhead — into the same container, and the API's
 * element stacking drops anything portalled elsewhere and fights the mobile
 * drawer. Promoting the container to `position: fixed` keeps the whole panel
 * intact and leaves Escape and the close button as ordinary React.
 *
 * MapLibre resizes its canvas from a ResizeObserver on the container, so the
 * class swap is enough on its own; `resize()` is still called on the next
 * frame because a missed observation shows up as a canvas that is the old
 * size, which is worse than a redundant call.
 */

/**
 * Above the nav and the mobile filter drawer (`z-50`), which it covers.
 *
 * Returned as a REPLACEMENT for the container's normal classes, never as an
 * addition to them. Tailwind emits `.relative` after `.fixed`, so a container
 * that keeps both — which every one of these panels does, since they position
 * their own overlays — stays `relative` no matter which class is written last
 * in the attribute, and "full-screen" silently does nothing but stretch the
 * panel in place. The same trap applies to the height classes each panel
 * carries (`h-full`, `h-[88vh]`), which would over-constrain the inset box.
 * Swapping the whole string is the only version of this that cannot lose.
 */
const FULLSCREEN_CLASS = "fixed inset-0 z-[60] overflow-hidden bg-abyss";

export function useMapFullscreen(mapRef?: RefObject<MapRef | null>) {
  const [fullscreen, setFullscreen] = useState(false);

  const toggle = useCallback(() => setFullscreen((v) => !v), []);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll under the overlay.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => mapRef?.current?.getMap()?.resize());
    return () => cancelAnimationFrame(frame);
  }, [fullscreen, mapRef]);

  /**
   * The map container's className. `base` is what it wears normally; `extra`
   * is anything the full-screen layout still needs (a panel whose header and
   * footer stay on screen has to remain a flex column, for instance).
   */
  const shellClass = useCallback(
    (base: string, extra = "") => (fullscreen ? `${FULLSCREEN_CLASS} ${extra}`.trim() : base),
    [fullscreen],
  );

  return { fullscreen, toggle, shellClass };
}

/**
 * One control in two places: the expand button sits bottom-right over the map,
 * and while full-screen it becomes a close button top-left, clear of the
 * navigation control and of the map's own bottom-edge provenance line.
 */
export function MapFullscreenButton({
  fullscreen,
  onToggle,
  positionClass = "right-2.5 bottom-9",
  exitPositionClass = "top-2.5 left-2.5",
}: {
  fullscreen: boolean;
  onToggle: () => void;
  /** Override where the expand button sits when a panel overlaps that corner. */
  positionClass?: string;
  /** Override when something else already owns the top-left corner. */
  exitPositionClass?: string;
}) {
  const label = fullscreen ? "ออกจากโหมดเต็มจอ" : "ดูแผนที่เต็มจอ";
  return (
    <button
      type="button"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={fullscreen}
      className={`absolute z-10 flex items-center gap-1.5 rounded border border-[rgba(56,100,150,0.5)] bg-[rgba(6,13,25,0.85)] px-2 py-1 text-[10.5px] text-ink-dim hover:text-ink ${
        fullscreen ? exitPositionClass : positionClass
      }`}
    >
      {fullscreen ? (
        <>
          <IconX size={12} stroke={1.7} />
          ปิดเต็มจอ
        </>
      ) : (
        <IconMaximize size={12} stroke={1.7} />
      )}
    </button>
  );
}
