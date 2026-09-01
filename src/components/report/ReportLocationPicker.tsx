"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map, {
  AttributionControl,
  Layer,
  Marker,
  NavigationControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
  type MarkerDragEvent,
} from "react-map-gl/maplibre";
import type { StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  IconAlertTriangle,
  IconCurrentLocation,
  IconLoader2,
  IconMapPin,
  IconSatellite,
  IconX,
} from "@tabler/icons-react";
import {
  SATELLITE_DEFAULT_ON,
  SATELLITE_SOURCE_ID,
  satelliteLayer,
  satelliteSource,
  setSatelliteBasemap,
  type BasemapFill,
} from "@/lib/basemap";
import { PROVINCE_BY_DDPM } from "@/lib/geo";
import { GEO_PRECISION_LABEL } from "@/lib/labels";
import {
  isInServiceArea,
  pinGeoPrecision,
  REPORT_PIN,
  snapToPinGrid,
  type PinSource,
} from "@/lib/report-form";
import type { ProvinceCode } from "@/lib/types";
import { MapFullscreenButton, useMapFullscreen } from "@/lib/map-fullscreen";

/**
 * Where the citizen says it happened.
 *
 * Three ways in, in the order a phone in someone's hand makes them useful: the
 * device's own GPS, a tap on the map, and dragging the marker to correct
 * either of those. The GPS fix is a starting point, never the answer — a
 * person filing a report is very often not standing at the scene, and the
 * marker has to be moveable for that case to be reportable at all.
 *
 * Boundaries are the same DDPM polygons the rest of the app draws, and the
 * default view stays free of third-party tiles for the same reason as every
 * other map here. But this is the one map where that costs a citizen
 * something real: an อำเภอ outline has no coastline, no road and no roof to
 * recognise, so the satellite toggle is offered right next to the GPS button
 * rather than buried. อำเภอ is still resolved from the pin and shown as text,
 * which is what confirms the marker landed where they meant when the imagery
 * is off.
 *
 * The marker snaps to the ~110 m grid from `REPORT_PIN` on every move. The
 * jump is visible on purpose: it is the interface being honest about the
 * resolution this report will be stored and published at.
 */

const SATELLITE_FILLS: readonly BasemapFill[] = [
  { layer: "thailand-fill", plain: 0.85, satellite: 0 },
  { layer: "province-fill", plain: 0.32, satellite: 0.12 },
];

/** Fitted to the four provinces the dataset covers. */
const BOUNDS: [[number, number], [number, number]] = [
  [99.95, 5.5],
  [102.2, 8.05],
];

export interface PickedPin {
  lng: number;
  lat: number;
  accuracyM: number | null;
  source: PinSource;
  /** DDPM อำเภอ code the pin fell in, resolved from the rendered polygons. */
  districtCode: string;
  districtName: string;
  provinceCode: ProvinceCode;
  provinceName: string;
  /**
   * ตำบล, filled in a moment after the pin lands.
   *
   * Two-phase on purpose: the อำเภอ polygons are already on screen, but the
   * ตำบล file is ~780 KB and is not fetched until someone actually places a
   * pin. A citizen on a phone who never touches the map never pays for it.
   */
  subdistrictCode: string | null;
  subdistrictName: string | null;
  /**
   * Nearest mapped หมู่บ้าน, with its distance. Null when nothing is mapped
   * nearby — which in these four provinces usually means OSM has no village
   * there yet, not that there is none.
   */
  village: { name: string; distanceM: number } | null;
}

type DistrictHit = Pick<
  PickedPin,
  "districtCode" | "districtName" | "provinceCode" | "provinceName"
>;

type Status = { kind: "idle" } | { kind: "locating" } | { kind: "error"; message: string };

const EMPTY_POINTS: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function style(): StyleSpecification {
  return {
    version: 8,
    sources: {
      thailand: { type: "geojson", data: "/data/thailand-provinces.geojson" },
      provinces: { type: "geojson", data: "/data/south-provinces.geojson" },
      districts: { type: "geojson", data: "/data/south-districts.geojson" },
      [SATELLITE_SOURCE_ID]: satelliteSource(),
    },
    layers: [
      { id: "sea", type: "background", paint: { "background-color": "#04070e" } },
      satelliteLayer(),
      {
        id: "thailand-fill",
        type: "fill",
        source: "thailand",
        paint: { "fill-color": "#0a1826", "fill-opacity": 0.85 },
      },
      {
        id: "province-fill",
        type: "fill",
        source: "provinces",
        paint: { "fill-color": "#12507f", "fill-opacity": 0.32 },
      },
      // Carries no colour of its own — it exists so `queryRenderedFeatures`
      // has a fill to hit-test the marker against. Querying the outline layer
      // instead would only match within a few pixels of a boundary, which is
      // exactly where the pin never is.
      {
        id: "district-hit",
        type: "fill",
        source: "districts",
        paint: { "fill-color": "#12507f", "fill-opacity": 0.01 },
      },
      {
        id: "district-outline",
        type: "line",
        source: "districts",
        paint: { "line-color": "#38bdf8", "line-width": 0.6, "line-opacity": 0.45 },
      },
      {
        id: "province-outline",
        type: "line",
        source: "provinces",
        paint: { "line-color": "#38bdf8", "line-width": 1.4, "line-opacity": 0.9 },
      },
    ],
  };
}

/**
 * ตำบล fill, queried the same way อำเภอ is. Rendered nearly invisible: the
 * outline below is what the eye reads, and a second tinted fill on top of the
 * province one would just darken the map.
 */
const SUBDISTRICT_HIT_LAYER = {
  id: "subdistrict-hit",
  type: "fill",
  paint: { "fill-color": "#12507f", "fill-opacity": 0.01 },
} satisfies LayerProps;

const SUBDISTRICT_OUTLINE_LAYER = {
  id: "subdistrict-outline",
  type: "line",
  paint: {
    "line-color": "#7dd3fc",
    "line-width": 0.4,
    // Fades in above the อำเภอ outline's own zoom so the two levels are never
    // competing for the same line at the same weight.
    "line-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0, 11, 0.35],
  },
} satisfies LayerProps;

/** หมู่บ้าน as dots. No labels — none of these styles declares `glyphs`. */
const VILLAGE_LAYER = {
  id: "village-point",
  type: "circle",
  minzoom: 11,
  paint: {
    "circle-color": "#e2f2ff",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.2, 15, 2.6],
    "circle-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.35, 14, 0.8],
  },
} satisfies LayerProps;

const ACCURACY_LAYER = {
  id: "accuracy-ring",
  type: "circle",
  paint: {
    "circle-color": "#38bdf8",
    "circle-opacity": 0.1,
    "circle-stroke-color": "#38bdf8",
    "circle-stroke-opacity": 0.5,
    "circle-stroke-width": 1,
    // metres -> pixels, following MapLibre's exponential zoom scaling — the
    // same ramp CaseLocationMap draws its uncertainty ring with.
    "circle-radius": [
      "interpolate", ["exponential", 2], ["zoom"],
      8, ["/", ["get", "accuracy_m"], 480],
      15, ["/", ["get", "accuracy_m"], 3.75],
    ],
  },
} satisfies LayerProps;

/**
 * Which อำเภอ is under the pin, read off the polygons MapLibre has already
 * drawn. Returns null when the point is outside the four provinces — and also
 * while the source is still loading, which the caller retries rather than
 * reporting as "nowhere".
 */
function districtAtPoint(map: MapRef, lng: number, lat: number): DistrictHit | null {
  const hits = map.queryRenderedFeatures(map.project([lng, lat]), { layers: ["district-hit"] });
  const props = hits[0]?.properties as Record<string, string> | undefined;
  if (!props) return null;

  const province = PROVINCE_BY_DDPM.get(String(props.province_code));
  if (!province) return null;

  return {
    districtCode: String(props.district_code),
    districtName: String(props.district_th),
    provinceCode: province.code,
    provinceName: province.name,
  };
}

/** Beyond this a village name describes somewhere else, so none is offered. */
const VILLAGE_NEAR_M = 2000;

const M_PER_DEG_LAT = 111_320;

function metresBetween(a: [number, number], b: [number, number]): number {
  const meanLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  return Math.hypot(
    (a[0] - b[0]) * M_PER_DEG_LAT * Math.cos(meanLat),
    (a[1] - b[1]) * M_PER_DEG_LAT,
  );
}

export default function ReportLocationPicker({
  onChange,
}: {
  /** Fires with the snapped pin, or null when there is no usable one. */
  onChange: (pin: PickedPin | null) => void;
}) {
  const mapRef = useRef<MapRef | null>(null);
  const { fullscreen, toggle: toggleFullscreen, shellClass } = useMapFullscreen(mapRef);
  const [pin, setPin] = useState<PickedPin | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [satellite, setSatellite] = useState(SATELLITE_DEFAULT_ON);
  /**
   * The map instance arrives asynchronously — react-map-gl loads maplibre-gl
   * itself, then fetches three boundary files before anything can be
   * hit-tested. Every control that needs the map is held until this flips, so
   * a citizen who taps GPS the moment the page paints gets a button that is
   * visibly waiting rather than one that silently does nothing.
   */
  const [ready, setReady] = useState(false);
  /**
   * Sticky once a pin has been placed. Mounting the ตำบล and หมู่บ้าน sources
   * is what fetches them, so the finest two levels cost nothing until the
   * citizen has actually committed to a location.
   */
  const [detail, setDetail] = useState(false);

  const mapStyle = useMemo(() => style(), []);

  const accuracyData = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!pin || pin.accuracyM === null) return EMPTY_POINTS;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [pin.lng, pin.lat] },
          // Never draw the ring tighter than the storage grid: a 5 m fix is
          // still published at ~110 m, and a ring showing 5 m would promise
          // precision the report does not carry.
          properties: { accuracy_m: Math.max(pin.accuracyM, REPORT_PIN.gridM / 2) },
        },
      ],
    };
  }, [pin]);

  /**
   * Places the pin: snap, bounds-check, then name the อำเภอ it landed in.
   *
   * `onChange` is called from here rather than from an effect on `pin`, so a
   * rejected placement never reaches the form at all.
   */
  const place = useCallback(
    (rawLng: number, rawLat: number, accuracyM: number | null, source: PinSource) => {
      const map = mapRef.current;
      if (!map) {
        // Unreachable while the controls are gated on `ready`, but never leave
        // the caller's "locating" state hanging if it ever is reached.
        setStatus({ kind: "error", message: "แผนที่ยังโหลดไม่เสร็จ กรุณาลองอีกครั้ง" });
        return;
      }

      const [lng, lat] = snapToPinGrid(rawLng, rawLat);

      if (!isInServiceArea(lng, lat)) {
        setStatus({
          kind: "error",
          message: "จุดที่เลือกอยู่นอกพื้นที่ 4 จังหวัดที่ระบบนี้ครอบคลุม",
        });
        return;
      }

      const commit = () => {
        const hit = districtAtPoint(map, lng, lat);
        if (!hit) {
          setStatus({
            kind: "error",
            message: "หมุดไม่ได้อยู่ในเขตอำเภอใด — อาจอยู่ในทะเลหรือนอกพื้นที่ กรุณาปักใหม่",
          });
          setPin(null);
          onChange(null);
          return;
        }
        setStatus({ kind: "idle" });
        const next: PickedPin = {
          lng,
          lat,
          accuracyM,
          source,
          ...hit,
          subdistrictCode: null,
          subdistrictName: null,
          village: null,
        };
        setPin(next);
        onChange(next);
        setDetail(true);
      };

      // The boundary source may still be in flight on the first interaction,
      // and `queryRenderedFeatures` would then report "no district" for a pin
      // that is in one. Waiting for idle asks again once there is a polygon to
      // hit.
      if (map.isSourceLoaded("districts")) commit();
      else map.once("idle", commit);
    },
    [onChange],
  );

  /**
   * Fills in ตำบล and the nearest หมู่บ้าน once their sources have loaded.
   *
   * Separate from `place` because those two sources are only mounted when the
   * first pin lands, so the answer is not available at the moment the pin is
   * placed. `resolvedFor` keys the work to a coordinate, which is what stops
   * this effect — which both reads and writes `pin` — from looping.
   */
  const resolvedFor = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pin || !detail) return;

    const key = `${pin.lng},${pin.lat}`;
    if (resolvedFor.current === key) return;

    const attempt = () => {
      if (!map.isSourceLoaded("subdistricts") || !map.isSourceLoaded("villages")) return false;
      resolvedFor.current = key;

      const point = map.project([pin.lng, pin.lat]);
      const tambon = map.queryRenderedFeatures(point, { layers: ["subdistrict-hit"] })[0]
        ?.properties as Record<string, string> | undefined;

      // `querySourceFeatures` rather than `queryRenderedFeatures`: villages are
      // only drawn above z11, and the nearest one has to be findable at any
      // zoom the citizen happens to be at.
      let nearest: { name: string; distanceM: number } | null = null;
      for (const f of map.querySourceFeatures("villages")) {
        const geometry = f.geometry as GeoJSON.Point;
        if (geometry?.type !== "Point") continue;
        const d = metresBetween([pin.lng, pin.lat], geometry.coordinates as [number, number]);
        if (d <= VILLAGE_NEAR_M && (!nearest || d < nearest.distanceM)) {
          nearest = { name: String(f.properties?.name_th ?? ""), distanceM: d };
        }
      }

      setPin((prev) => {
        if (!prev || `${prev.lng},${prev.lat}` !== key) return prev;
        const next: PickedPin = {
          ...prev,
          subdistrictCode: tambon ? String(tambon.subdistrict_code) : null,
          subdistrictName: tambon ? String(tambon.subdistrict_th) : null,
          village: nearest,
        };
        onChange(next);
        return next;
      });
      return true;
    };

    if (attempt()) return;
    const onIdle = () => {
      if (attempt()) map.off("idle", onIdle);
    };
    map.on("idle", onIdle);
    return () => {
      map.off("idle", onIdle);
    };
  }, [pin, detail, onChange]);

  const handleMapClick = useCallback(
    (e: MapLayerMouseEvent) => place(e.lngLat.lng, e.lngLat.lat, null, "manual"),
    [place],
  );

  const handleDragEnd = useCallback(
    // A dragged marker is a human statement about the scene, so the device's
    // accuracy estimate has stopped describing it and is dropped.
    (e: MarkerDragEvent) => place(e.lngLat.lng, e.lngLat.lat, null, "manual"),
    [place],
  );

  // Applied from an effect rather than from the click handler: the imagery
  // lives in the base style, so the choice has to be re-applied to whatever
  // map instance exists, not fired once at a map that may not be there yet.
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !ready) return;
    setSatelliteBasemap(map, satellite, SATELLITE_FILLS);
  }, [satellite, ready]);

  function locate() {
    if (!navigator.geolocation) {
      setStatus({ kind: "error", message: "อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง" });
      return;
    }
    // Outside a secure context the browser refuses outright, with a permission
    // error that reads as if the citizen denied it. Say what actually happened.
    if (!window.isSecureContext) {
      setStatus({
        kind: "error",
        message: "เบราว์เซอร์ให้ใช้ GPS เฉพาะบน HTTPS — กรุณาแตะแผนที่เพื่อปักหมุดเอง",
      });
      return;
    }

    setStatus({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude, accuracy } = position.coords;
        const accuracyM = Number.isFinite(accuracy) ? accuracy : null;

        // A fix this loose is wider than the อำเภอ centroid the form already
        // falls back to, so accepting it would add error, not location.
        if (accuracyM !== null && accuracyM > REPORT_PIN.maxAccuracyM) {
          setStatus({
            kind: "error",
            message: `สัญญาณ GPS คลาดเคลื่อนราว ${Math.round(accuracyM).toLocaleString("en-US")} ม. ซึ่งกว้างเกินกว่าจะระบุจุดได้ กรุณาแตะแผนที่เพื่อปักหมุดเอง`,
          });
          return;
        }

        mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 14.5, duration: 600 });
        place(longitude, latitude, accuracyM, "gps");
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง — เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์ หรือแตะแผนที่เพื่อปักหมุดเอง"
            : error.code === error.TIMEOUT
              ? "หาตำแหน่งไม่ทันเวลา กรุณาลองใหม่ หรือแตะแผนที่เพื่อปักหมุดเอง"
              : "อุปกรณ์ระบุตำแหน่งไม่ได้ในขณะนี้ กรุณาแตะแผนที่เพื่อปักหมุดเอง";
        setStatus({ kind: "error", message });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function clear() {
    resolvedFor.current = null;
    setPin(null);
    setStatus({ kind: "idle" });
    onChange(null);
  }

  const locating = status.kind === "locating";
  const busy = locating || !ready;

  return (
    <div
      // Full-screen keeps the toolbar and the read-out either side of the map
      // — the pin is placed against them, not against the map alone — so the
      // card becomes the column and the map box takes what is left.
      className={shellClass(
        "rounded border border-[rgba(37,66,102,0.8)] bg-[#0a1524]",
        "flex flex-col",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[rgba(37,66,102,0.6)] px-2.5 py-2">
        <button
          type="button"
          onClick={locate}
          disabled={locating || !ready}
          className="flex items-center gap-1.5 rounded bg-[rgba(56,189,248,0.14)] px-2.5 py-1.5 text-[11.5px] text-azure hover:bg-[rgba(56,189,248,0.24)] disabled:opacity-70"
        >
          {busy ? (
            <IconLoader2 size={13} stroke={2} className="animate-spin" />
          ) : (
            <IconCurrentLocation size={13} stroke={1.8} />
          )}
          ใช้ตำแหน่งปัจจุบัน
        </button>
        <button
          type="button"
          onClick={() => setSatellite((v) => !v)}
          aria-pressed={satellite}
          disabled={!ready}
          className={`flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-[11.5px] ${
            satellite
              ? "border-azure bg-[rgba(56,189,248,0.18)] text-azure"
              : "border-[rgba(56,100,150,0.6)] text-ink-dim hover:text-ink"
          } disabled:opacity-60`}
        >
          <IconSatellite size={13} stroke={1.8} />
          ดาวเทียม
        </button>
        <span className="text-[10.5px] text-ink-muted">
          หรือแตะแผนที่เพื่อปักหมุด แล้วลากหมุดเพื่อปรับให้ตรงจุด
        </span>
        {pin && (
          <button
            type="button"
            onClick={clear}
            className="ml-auto flex items-center gap-1 text-[10.5px] text-ink-dim hover:text-ink"
          >
            <IconX size={11} stroke={2} />
            ล้างหมุด
          </button>
        )}
      </div>

      {/* Sized with width/height 100% on a fixed-height box rather than
          `absolute inset-0`: maplibre-gl.css forces `position: relative` on
          its container, which cancels the insets and collapses the box to zero
          height with no error anywhere. */}
      <div
        className={`relative w-full ${
          fullscreen ? "min-h-0 flex-1" : "h-[min(80vh,680px)] sm:h-[560px]"
        }`}
      >
        <Map
          ref={mapRef}
          initialViewState={{ bounds: BOUNDS, fitBoundsOptions: { padding: 12 } }}
          mapStyle={mapStyle}
          style={{ width: "100%", height: "100%" }}
          attributionControl={false}
          dragRotate={false}
          cursor="crosshair"
          onClick={handleMapClick}
          onLoad={() => setReady(true)}
          onError={(e) => console.error("[maplibre]", e.error?.message ?? String(e))}
        >
          <NavigationControl showCompass={false} position="top-right" />
          <AttributionControl compact position="bottom-right" />

          {/* Mounted only after the first pin — mounting is fetching. */}
          {detail && (
            <>
              <Source id="subdistricts" type="geojson" data="/data/south-subdistricts.geojson">
                <Layer {...SUBDISTRICT_HIT_LAYER} />
                <Layer {...SUBDISTRICT_OUTLINE_LAYER} />
              </Source>
              <Source id="villages" type="geojson" data="/data/south-villages.geojson">
                <Layer {...VILLAGE_LAYER} />
              </Source>
            </>
          )}

          <Source id="accuracy" type="geojson" data={accuracyData}>
            <Layer {...ACCURACY_LAYER} />
          </Source>

          {pin && (
            <Marker
              longitude={pin.lng}
              latitude={pin.lat}
              draggable
              onDragEnd={handleDragEnd}
              anchor="center"
            >
              {/* A teardrop, inline-styled so it needs no Tailwind class to
                  survive into the marker MapLibre reparents into the map. */}
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50% 50% 50% 0",
                  transform: "rotate(-45deg)",
                  background: "#38bdf8",
                  border: "2px solid #e2f2ff",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.55)",
                  cursor: "grab",
                }}
              />
            </Marker>
          )}
        </Map>

        <MapFullscreenButton
          fullscreen={fullscreen}
          onToggle={toggleFullscreen}
          positionClass="right-2.5 bottom-2.5"
        />
      </div>

      <div className="border-t border-[rgba(37,66,102,0.6)] px-2.5 py-2">
        {status.kind === "error" ? (
          <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-amber">
            <IconAlertTriangle size={12} stroke={1.8} className="mt-px shrink-0" />
            {status.message}
          </p>
        ) : pin ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px]">
            <span className="flex items-center gap-1 text-azure">
              <IconMapPin size={12} stroke={1.8} />
              {pin.subdistrictName && `ต.${pin.subdistrictName} `}อ.{pin.districtName} จ.
              {pin.provinceName}
            </span>
            {/* Named, with its distance. The distance is not decoration: OSM
                has only about a fifth of the villages in these provinces, so
                "the nearest one" can easily be the wrong side of a ตำบล. */}
            {pin.village && (
              <span className="text-ink-dim">
                ใกล้บ้าน{pin.village.name}{" "}
                <span className="num">{Math.round(pin.village.distanceM / 10) * 10}</span> ม.
              </span>
            )}
            <span className="num text-ink-dim">
              {pin.lat.toFixed(REPORT_PIN.gridDecimals)}, {pin.lng.toFixed(REPORT_PIN.gridDecimals)}
            </span>
            <span className="text-ink-muted">
              {pin.source === "gps" && pin.accuracyM !== null
                ? `จาก GPS ±${Math.round(pin.accuracyM).toLocaleString("en-US")} ม.`
                : "ปักเอง"}{" "}
              · บันทึกที่ความละเอียด {GEO_PRECISION_LABEL[pinGeoPrecision(pin.accuracyM)]}
            </span>
          </div>
        ) : (
          <p className="text-[10.5px] leading-relaxed text-ink-muted">
            ถ้าไม่ปักหมุด ระบบจะใช้จุดอ้างอิงกลางอำเภอที่เลือกไว้แทน
          </p>
        )}
        <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">
          พิกัดจะถูกปัดให้หยาบราว {REPORT_PIN.gridM} เมตรก่อนบันทึก
          เพื่อไม่ให้ตำแหน่งที่เผยแพร่ระบุตัวผู้แจ้งได้ — หมุดจึงขยับเข้าหาตารางเล็กน้อยทุกครั้งที่วาง
        </p>
      </div>
    </div>
  );
}
