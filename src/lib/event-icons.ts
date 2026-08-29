import {
  Bomb,
  CarFront,
  CircleDashed,
  CloudFog,
  CloudLightning,
  Crosshair,
  Ellipsis,
  FireExtinguisher,
  Flame,
  Grid2X2,
  House,
  Map as MapGlyph,
  MapPin,
  Mountain,
  PanelsTopLeft,
  Pill,
  Radar,
  Search,
  ShieldAlert,
  Siren,
  Sun,
  TriangleAlert,
  UserRoundArrowLeft,
  UsersRound,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import type { EventFamily, EventType } from "./types";

/**
 * One glyph per event type, to be shown *alongside* `EVENT_COLOR` — never
 * instead of it.
 *
 * Seventeen categories is well past what hue alone separates (see the note on
 * `EVENT_COLOR`), and the palette has already had to group the newer types by
 * tone rather than by hue: three of the disaster colours are neighbours on the
 * wheel. Shape is the second channel that makes them tell apart. So the rule
 * this file exists to enforce is: **shape = which kind of event, colour = the
 * family/severity reading the palette already carries**. A 💣 stays a 💣
 * whatever the dot underneath it is doing.
 *
 * That second channel is also what makes the vocabulary legible to a reader
 * who cannot use the first one: roughly 1 in 12 men has a red-green colour
 * vision deficiency, and `unrest`/`raid` (#ef4444 / #22c55e) is exactly the
 * pair that collapses for them.
 *
 * Lucide rather than Tabler — which the rest of the chrome uses — on purpose:
 * these are content, not controls, and keeping them in a set of their own is
 * what stops an event glyph being reached for as a button icon later. See
 * `mockup/icon.md` for the mapping's rationale, type by type.
 */
export const EVENT_ICON: Record<EventType, LucideIcon> = {
  // ความไม่สงบ
  explosion: Bomb,
  shooting: Crosshair,
  arson: Flame,
  unrest: Siren,
  // กลุ่มเคลื่อนไหว — a person leaving the frame, not handcuffs: the report is
  // about someone who was taken, and drawing them as a suspect would be the UI
  // asserting something the record does not.
  abduction: UserRoundArrowLeft,
  gang: UsersRound,
  // บังคับใช้กฎหมาย / อาชญากรรม
  raid: Search,
  narcotics: Pill,
  crime: ShieldAlert,
  // ภัยพิบัติธรรมชาติ
  flood: Waves,
  storm: Wind,
  landslide: Mountain,
  // Haze, not flames: `wildfire` is the ไฟป่า/หมอกควัน pair, and the thing a
  // reader is usually looking at is the smoke. `Flame` is spoken for by arson.
  wildfire: CloudFog,
  drought: Sun,
  // อุบัติภัย — an extinguisher reads as "a fire being fought" rather than
  // "a fire someone set", which is the whole distinction between `fire` and
  // `arson` that `EVENT_TYPES` draws.
  fire: FireExtinguisher,
  accident: CarFront,
  other: Ellipsis,
};

/**
 * One glyph per family, for the headings a legend or filter group prints above
 * its types. `violence` and `safety` deliberately share `TriangleAlert`: both
 * are "a hazard" at this altitude, and the heading always carries its Thai
 * label and its own colour beside the glyph.
 */
export const EVENT_FAMILY_ICON: Record<EventFamily, LucideIcon> = {
  violence: TriangleAlert,
  gang: UsersRound,
  narcotics: Pill,
  crime: ShieldAlert,
  disaster: CloudLightning,
  safety: TriangleAlert,
  other: Ellipsis,
};

/**
 * The non-event rows of the map legend — basemap fills, boundary lines and the
 * positional-uncertainty halo.
 *
 * Kept here beside `EVENT_ICON` rather than in `MapPanel` because the swatches
 * they label (a filled square, a hairline, a dashed ring) are the part a
 * reader has the hardest time telling apart at 10.5px, and a legend that
 * explains its event dots but not its lines is only half a legend.
 */
export const MAP_LAYER_ICON = {
  surveillance_area: Radar,
  other_province: MapPin,
  province_boundary: MapGlyph,
  district_boundary: PanelsTopLeft,
  subdistrict_boundary: Grid2X2,
  osm_village: House,
  uncertainty_boundary: CircleDashed,
} as const satisfies Record<string, LucideIcon>;
