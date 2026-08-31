import { msOrNull } from "@/lib/datetime";
import { DEFAULT_FILTERS, type InvestigationFilters } from "@/lib/filters";
import {
  districtAt,
  loadDistricts,
  loadProvinces,
  loadSubdistricts,
  subdistrictAt,
} from "@/lib/geography";
import { loadBundle, matchedEvents, toEventFeature, type EventFeatureCollection } from "./shared-events";
import type { EventCandidateDoc } from "@/lib/types";

/**
 * The data behind `/map`.
 *
 * `/investigate` answers "what happened"; this answers "where is it
 * concentrated". The difference is the unit: a dot map plots incidents, and at
 * four-province zoom a thousand dots is a smear that says only "the south".
 * Counting into administrative areas instead gives a rate per place — and
 * because those places nest (จังหวัด > อำเภอ > ตำบล), the same question can be
 * asked at three resolutions without changing the visual grammar.
 *
 * Areas are resolved by **containment against the polygons**, not by matching
 * `location.district` strings. The names in the documents come from a dozen
 * publishers with their own spellings and prefixes; the geometry does not. It
 * also means an area count can never disagree with where the dot is drawn.
 */

export type AreaLevel = "province" | "district" | "subdistrict";

export interface AreaCount {
  /** DDPM code — the join key to the boundary files. */
  code: string;
  name: string;
  /** The unit above this one, for disambiguating repeated ตำบล names. */
  parent: string | null;
  n: number;
  /**
   * [minLng, minLat, maxLng, maxLat], so the client can frame this area
   * without it being on screen first. Reading the extent off the rendered
   * source instead would only ever find areas already in view — which is
   * precisely the wrong half of a "jump to the worst place" list.
   */
  bbox: [number, number, number, number];
}

export interface MapOverview {
  live: boolean;
  filters: InvestigationFilters;
  /** Counts per DDPM code at each level, for the choropleth's match expression. */
  counts: Record<AreaLevel, Record<string, number>>;
  /** Highest count at each level — the top of the colour scale. */
  max: Record<AreaLevel, number>;
  /** How many distinct areas have at least one event, per level. */
  touched: Record<AreaLevel, number>;
  /** Ranked areas, longest-first, for the rollup panel. */
  top: Record<AreaLevel, AreaCount[]>;
  totals: {
    matched: number;
    /** Events with coordinates — the only ones a map can count. */
    placed: number;
    /** Matched but carrying no point: counted nowhere on this page. */
    unplaced: number;
    /** Placed but landing outside all four provinces (sea, or bad geocode). */
    offArea: number;
  };
  span: { start: number; end: number } | null;
}

const TOP_N = 12;

/** Adds one to `code`, remembering the label the first time it is seen. */
function tally(
  into: Map<string, AreaCount>,
  code: string,
  name: string,
  parent: string | null,
  bbox: [number, number, number, number],
): void {
  const row = into.get(code);
  if (row) row.n += 1;
  else into.set(code, { code, name, parent, n: 1, bbox });
}

function rank(rows: Map<string, AreaCount>): AreaCount[] {
  return Array.from(rows.values())
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "th"))
    .slice(0, TOP_N);
}

function countsOf(rows: Map<string, AreaCount>): Record<string, number> {
  return Object.fromEntries(Array.from(rows.values(), (r) => [r.code, r.n]));
}

function maxOf(rows: Map<string, AreaCount>): number {
  let max = 0;
  for (const row of rows.values()) if (row.n > max) max = row.n;
  return max;
}

/**
 * The individual points, fetched separately.
 *
 * Nine thousand events serialise to roughly 6.5 MB, and the dot layer they
 * feed is off by default — this page is about areas. Shipping them with the
 * initial payload would make every visit pay for a layer most visits never
 * turn on, so they are served from `/api/map/events` when someone does.
 */
export async function getMapEvents(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<EventFeatureCollection> {
  const bundle = await loadBundle();
  const matched = matchedEvents(bundle, filters, { now: new Date() });
  return {
    type: "FeatureCollection",
    features: matched.map(toEventFeature).filter((f) => f !== null),
  };
}

export async function getMapOverview(
  filters: InvestigationFilters = DEFAULT_FILTERS,
): Promise<MapOverview> {
  const bundle = await loadBundle();
  const now = new Date();
  const matched = matchedEvents(bundle, filters, { now });

  // Warm the caches once rather than on the first lookup inside the loop, so
  // the cost is visible here rather than hidden in a per-event branch.
  loadDistricts();
  loadSubdistricts();
  const provinceByCode = new Map(loadProvinces().map((p) => [p.code, p]));

  const provinces = new Map<string, AreaCount>();
  const districts = new Map<string, AreaCount>();
  const subdistricts = new Map<string, AreaCount>();

  let placed = 0;
  let offArea = 0;

  for (const e of matched as EventCandidateDoc[]) {
    const coordinates = e.location.geo?.coordinates;
    if (!coordinates) continue;
    placed += 1;

    const point: [number, number] = [coordinates[0], coordinates[1]];
    const district = districtAt(point);
    if (!district) {
      // In the sea, or geocoded outside the four provinces. Counted as a
      // total rather than silently dropped — a rising number here is a data
      // problem, and it should be visible as one.
      offArea += 1;
      continue;
    }

    const province = provinceByCode.get(district.provinceCode);
    if (province) {
      tally(provinces, province.code, province.nameTh, null, province.bbox);
    }
    tally(districts, district.code, district.nameTh, district.provinceNameTh, district.bbox);

    const subdistrict = subdistrictAt(point);
    if (subdistrict) {
      tally(
        subdistricts,
        subdistrict.code,
        subdistrict.nameTh,
        `อ.${subdistrict.districtNameTh}`,
        subdistrict.bbox,
      );
    }
  }

  // Unreadable timestamps are dropped rather than defaulted: this feeds the
  // reported date span, and a fallback would widen it to a range no event
  // actually occupies.
  const timestamps = matched
    .map((e) => msOrNull(e.time.start))
    .filter((ms): ms is number => ms !== null);

  return {
    live: bundle.live,
    filters,
    counts: {
      province: countsOf(provinces),
      district: countsOf(districts),
      subdistrict: countsOf(subdistricts),
    },
    max: {
      province: maxOf(provinces),
      district: maxOf(districts),
      subdistrict: maxOf(subdistricts),
    },
    touched: {
      province: provinces.size,
      district: districts.size,
      subdistrict: subdistricts.size,
    },
    top: {
      province: rank(provinces),
      district: rank(districts),
      subdistrict: rank(subdistricts),
    },
    totals: {
      matched: matched.length,
      placed,
      unplaced: matched.length - placed,
      offArea,
    },
    span: timestamps.length
      ? { start: Math.min(...timestamps), end: Math.max(...timestamps) }
      : null,
  };
}
