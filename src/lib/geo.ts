import type { ProvinceCode } from "./types";

export interface ProvinceMeta {
  code: ProvinceCode;
  name: string;
  center: [number, number]; // [lng, lat]
  districts: string[];
}

/** The four provinces covered by the Deep South conflict dataset. */
export const PROVINCES: ProvinceMeta[] = [
  {
    code: "pattani",
    name: "ปัตตานี",
    center: [101.25, 6.87],
    districts: [
      "เมืองปัตตานี",
      "หนองจิก",
      "ยะรัง",
      "สายบุรี",
      "โคกโพธิ์",
      "ปะนาเระ",
      "มายอ",
      "ยะหริ่ง",
    ],
  },
  {
    code: "yala",
    name: "ยะลา",
    center: [101.28, 6.54],
    districts: [
      "เมืองยะลา",
      "บันนังสตา",
      "ยะหา",
      "รามัน",
      "ธารโต",
      "กาบัง",
      "เบตง",
      "กรงปินัง",
    ],
  },
  {
    code: "narathiwat",
    name: "นราธิวาส",
    center: [101.82, 6.43],
    districts: [
      "เมืองนราธิวาส",
      "ระแงะ",
      "รือเสาะ",
      "สุไหงโก-ลก",
      "ตากใบ",
      "บาเจาะ",
      "จะแนะ",
      "สุคิริน",
    ],
  },
  {
    code: "songkhla",
    name: "สงขลา",
    center: [100.75, 6.85],
    districts: ["เทพา", "จะนะ", "นาทวี", "สะบ้าย้อย", "หาดใหญ่"],
  },
];

export const PROVINCE_BY_CODE = new Map(PROVINCES.map((p) => [p.code, p]));

/** Bounding box of the map viewport used by the investigation map panel. */
export const MAP_BOUNDS = {
  minLng: 100.35,
  maxLng: 102.15,
  minLat: 5.95,
  maxLat: 7.35,
} as const;

/** Project [lng, lat] into 0-100 viewBox space (y flipped, north at top). */
export function project([lng, lat]: [number, number]): { x: number; y: number } {
  const { minLng, maxLng, minLat, maxLat } = MAP_BOUNDS;
  return {
    x: ((lng - minLng) / (maxLng - minLng)) * 100,
    y: (1 - (lat - minLat) / (maxLat - minLat)) * 100,
  };
}
