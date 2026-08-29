แนะนำใช้ **Lucide Icons (`lucide-react`)** เป็นชุดหลัก จะเหมาะกับ Palantir-TH เพราะเส้น icon สม่ำเสมอ, SVG, ปรับ `color / size / strokeWidth` ได้ และ tree-shakable เหมาะกับ React/Next.js ([Lucide][1])

```bash
npm install lucide-react
```

### Icon mapping ที่แนะนำ

| กลุ่ม           | รายการ                     | Lucide Icon | React name           | เหตุผล                     |
| --------------- | -------------------------- | ----------- | -------------------- | -------------------------- |
| 🔴 เหตุรุนแรง   | **เหตุรุนแรง**             | ⚠️          | `TriangleAlert`      | category หลัก              |
|                 | ลอบวางระเบิด               | 💣          | `Bomb`               | ตรงความหมายที่สุด          |
|                 | ยิง/ปะทะ                   | ⊕           | `Crosshair`          | เหตุยิง/armed engagement   |
|                 | วางเพลิง                   | 🔥          | `Flame`              | จุดไฟ/เผาทำลาย             |
|                 | เหตุไม่สงบ                 | 🚨          | `Siren`              | เหตุความมั่นคง/ฉุกเฉิน     |
| 🟣 กิจกรรมกลุ่ม | **กิจกรรมกลุ่ม**           | 👥          | `UsersRound`         | การรวมตัวของกลุ่ม          |
|                 | ลักพาตัว                   | 👤←         | `UserRoundArrowLeft` | บุคคลถูกนำออกจากพื้นที่    |
|                 | กิจกรรมกลุ่ม               | 👥          | `UsersRound`         | กลุ่มบุคคล                 |
| 🟪 ยาเสพติด     | **ยาเสพติด**               | 💊          | `Pill`               | อ่านออกทันที               |
|                 | ยาเสพติด                   | 💊          | `Pill`               | —                          |
| 🟠 อาชญากรรม    | **อาชญากรรม**              | 🛡️!        | `ShieldAlert`        | threat / crime             |
|                 | อาชญากรรม                  | 🛡️!        | `ShieldAlert`        | —                          |
| 🔵 ภัยธรรมชาติ  | **ภัยพิบัติธรรมชาติ**      | ☁️⚡         | `CloudLightning`     | category หลัก              |
|                 | อุทกภัย                    | 〰️          | `Waves`              | น้ำท่วม                    |
|                 | วาตภัย                     | 💨          | `Wind`               | ลม/พายุ                    |
|                 | ดินโคลนถล่ม                | ⛰️          | `Mountain`           | ภูเขา/ลาดเขา               |
|                 | ไฟป่า/หมอกควัน             | 🌫️         | `CloudFog`           | หมอกควัน/visibility        |
|                 | ภัยแล้ง                    | ☀️          | `Sun`                | ร้อน/แห้งแล้ง              |
| 🟡 อุบัติภัย    | **อุบัติภัย**              | ⚠️          | `TriangleAlert`      | hazard ทั่วไป              |
|                 | อัคคีภัย                   | 🧯          | `FireExtinguisher`   | แยกจาก “วางเพลิง” ได้ชัด   |
|                 | อุบัติเหตุ                 | 🚘          | `CarFront`           | road accident              |
| ⚪ อื่น ๆ        | ตรวจค้น/จับกุม             | 🔍          | `Search`             | search operation           |
|                 | อื่น ๆ                     | ⋯           | `Ellipsis`           | unknown/other              |
| 🗺️ Layer       | พื้นที่เฝ้าระวัง 4 จังหวัด | 📡          | `Radar`              | surveillance/monitoring    |
|                 | จังหวัดอื่น                | 📍          | `MapPin`             | geographic region          |
|                 | ขอบเขตจังหวัด              | 🗺️         | `Map`                | administrative boundary    |
|                 | ขอบเขตอำเภอ                | ◫           | `PanelsTopLeft`      | boundary level 2           |
|                 | ขอบเขตตำบล                 | ▦           | `Grid2X2`            | boundary level 3           |
|                 | หมู่บ้าน (OSM)             | 🏠          | `House`              | settlement                 |
|                 | ขอบเขตความคลาด             | ◌           | `CircleDashed`       | uncertainty / error buffer |

สำหรับ **ลักพาตัว** ผมชอบ `UserRoundArrowLeft` มากกว่า icon รูปกุญแจมือ เพราะ UI ควรบอกว่าเป็น “เหตุการณ์เกี่ยวกับบุคคล” มากกว่าสื่อว่าเป็นผู้ต้องหา

นำเข้าได้แบบนี้:

```tsx
import {
  TriangleAlert,
  Bomb,
  Crosshair,
  Flame,
  Siren,

  UsersRound,
  UserRoundArrowLeft,

  Pill,
  ShieldAlert,

  CloudLightning,
  Waves,
  Wind,
  Mountain,
  CloudFog,
  Sun,

  FireExtinguisher,
  CarFront,

  Search,
  Ellipsis,

  Radar,
  MapPin,
  Map,
  PanelsTopLeft,
  Grid2X2,
  House,
  CircleDashed,
} from "lucide-react";
```

และถ้าจะทำ config สำหรับ map ผมแนะนำเก็บแบบนี้:

```tsx
export const EVENT_ICONS = {
  bombing: Bomb,
  shooting: Crosshair,
  arson: Flame,
  unrest: Siren,

  kidnapping: UserRoundArrowLeft,
  group_activity: UsersRound,

  drugs: Pill,
  crime: ShieldAlert,

  flood: Waves,
  storm: Wind,
  landslide: Mountain,
  wildfire_haze: CloudFog,
  drought: Sun,

  fire: FireExtinguisher,
  accident: CarFront,

  search_arrest: Search,
  other: Ellipsis,
} as const;

export const MAP_LAYER_ICONS = {
  surveillance_area: Radar,
  other_province: MapPin,

  province_boundary: Map,
  district_boundary: PanelsTopLeft,
  subdistrict_boundary: Grid2X2,

  osm_village: House,
  uncertainty_boundary: CircleDashed,
} as const;
```

จุดที่ผมแนะนำเป็นพิเศษคือ **อย่าใช้สีอย่างเดียวในการแยกประเภทเหตุการณ์** — ให้ `shape/icon = ประเภทเหตุการณ์` และ `color = severity/category` เช่น 💣 Bomb ยังเป็น Bomb เสมอ แต่แดงเข้ม/แดงอ่อนใช้แสดงระดับความรุนแรง แบบนี้เวลา map มี marker จำนวนมากจะอ่าน pattern ได้เร็วกว่าครับ.

[1]: https://lucide.dev/?utm_source=chatgpt.com "Lucide"
