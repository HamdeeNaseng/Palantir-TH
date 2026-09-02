"use client";

import { useEffect, useState } from "react";

/**
 * Whether this device should be given the cheaper map.
 *
 * The corpus draws three overlapping washes over the same 9,749 points — the
 * heatmap, the uncertainty halos, and the dots themselves. On a desktop that
 * is a rounding error. On a low-end phone the two area layers are the
 * expensive half: both rasterise across the whole viewport every frame, where
 * the dots cost roughly one quad each, so they are what gets dropped when
 * there is not enough GPU or memory to go round.
 *
 * `deviceMemory` is Chromium-only and coarse (it reports 0.25–8 and nothing
 * above), `hardwareConcurrency` is broadly supported. Either being small is
 * taken as the signal; a browser that reports neither is assumed capable,
 * because degrading a machine that did not ask for it is the worse mistake.
 */
const MAX_LOW_SPEC_CORES = 4;
const MAX_LOW_SPEC_MEMORY_GB = 4;

export function useLowSpecDevice(): boolean {
  // Starts false and is decided after mount: `navigator` does not exist during
  // the server render, and guessing on the server would mean the first client
  // paint disagreed with the HTML it hydrated.
  const [lowSpec, setLowSpec] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency;
    const memory = nav.deviceMemory;
    setLowSpec(
      (typeof cores === "number" && cores > 0 && cores <= MAX_LOW_SPEC_CORES) ||
        (typeof memory === "number" && memory > 0 && memory <= MAX_LOW_SPEC_MEMORY_GB),
    );
  }, []);

  return lowSpec;
}
