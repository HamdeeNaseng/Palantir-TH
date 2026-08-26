# Palantir TH

แพลตฟอร์มวิเคราะห์เหตุการณ์ความมั่นคงชายแดนใต้ — Next.js 15 (App Router, TypeScript) + MongoDB

หน้าที่สร้างแล้ว

- **สืบสวน** (`/investigate`) ตาม `mockup/page สืบสวน.png` — ภาพรวมของพื้นที่
- **ทะเบียนเคส** (`/cases`, `/cases/[id]`) — ตารางเหตุการณ์ทั้งหมด ค้นหา/กรอง แล้วกดเข้าไปดูรายเคส
- **รายงานจากประชาชน** (`/report`) — ตารางเดียวกันกรองเฉพาะรายงานที่ประชาชนส่งเข้ามา
  พร้อมฟอร์มแจ้งเหตุที่บันทึกลง `raw_records` -> `event_candidates` ตาม protocol ใน `mockup/MVP.md`
- **เหตุการณ์** (`/events`) ตาม `mockup/page เหตุการณ์.png` — ไทม์ไลน์เล่นย้อนหลังของเหตุการณ์ที่ตรงกับตัวกรอง

![หน้าสืบสวน](mockup/page%20%E0%B8%AA%E0%B8%B7%E0%B8%9A%E0%B8%AA%E0%B8%A7%E0%B8%99.png)

## เริ่มใช้งาน

```bash
cp .env.example .env   # แล้วแก้รหัสผ่านก่อนใช้งานจริง
docker compose up -d   # MongoDB 8 บน localhost:27017
npm install
npm run db:seed        # สร้างข้อมูลตัวอย่างตาม MVP.md
npm run dev            # http://localhost:3000
```

ถ้ายังไม่ได้รัน MongoDB หน้าเว็บจะยังแสดงผลได้โดยใช้ชุดข้อมูลตัวอย่างในหน่วยความจำ
และขึ้นแถบเตือนไว้ที่มุมขวาบน — ทั้งสองเส้นทางใช้โค้ด aggregation ชุดเดียวกัน

ค่าเริ่มต้น `changeme` ใน `.env.example` มีไว้สำหรับ development เท่านั้น

| คำสั่ง | ทำอะไร |
| --- | --- |
| `npm run dev` | dev server (เขียนลง `.next/`) |
| `npm run build` | production build (เขียนลง `.next-build/`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:seed` | seed ข้อมูลตัวอย่าง — ต่อท้าย `-- --force` เพื่อ reseed |
| `npm run test:e2e` | Playwright — GPS จำลอง + mobile viewport (เปิด dev server ให้เอง บน `.next-e2e/`) |
| `npm run gis:fetch` | ดึงขอบเขต DDPM (จังหวัด/อำเภอ/ตำบล) — `-- --only=<layer>` เพื่อดึงเฉพาะชั้นเดียว |
| `npm run gis:villages` | ดึงจุดหมู่บ้านจาก OpenStreetMap (ODbL) — ไม่ใช่ข้อมูลทางการ ครอบคลุมไม่ครบ |

dev กับ build แยก `distDir` กันเพื่อไม่ให้แย่ง file handle บน `.next/trace`
เวลารัน build ขณะที่ dev server ยังทำงานอยู่ (ดู `next.config.ts`)
ถ้าต้องเปิด dev server ตัวที่สองพร้อมกัน ให้กำหนด `distDir` ของมันแยกออกไปด้วย
ไม่งั้นตัวที่สองจะตายด้วย `EPERM` ตอนเปิด `.next/trace`

```bash
NEXT_DIST_DIR=.next-alt npx next dev -p 3100
```

Next.js จะเติม `.next-alt/types/**/*.ts` เข้าไปใน `tsconfig.json` ให้เอง — เป็นการแก้ไฟล์จริง
ปิด dev server ตัวนั้นแล้วอย่าลืม revert `tsconfig.json` กลับ

## โครงสร้าง

```
src/
├── app/
│   ├── investigate/page.tsx     หน้าสืบสวน (server component, อ่าน searchParams)
│   ├── cases/page.tsx           ทะเบียนเคส — ตาราง ค้นหา กรอง แบ่งหน้า
│   ├── cases/[id]/page.tsx      รายละเอียดรายเคส + raw record ที่มันมาจาก
│   ├── case/…                   alias ของ /cases (redirect, เผื่อพิมพ์เอกพจน์)
│   ├── report/page.tsx          รายงานจากประชาชน — ตารางเดิม กรองเฉพาะ src_citizen + ฟอร์มแจ้งเหตุ
│   ├── events/page.tsx          เหตุการณ์ — ไทม์ไลน์เล่นย้อนหลัง (server component, อ่าน searchParams)
│   ├── map/page.tsx             แผนที่ภาพรวม — ความหนาแน่นรายจังหวัด/อำเภอ/ตำบล ตามระดับซูม
│   ├── api/map/events/route.ts  จุดเหตุการณ์สำหรับ /map (ดึงเมื่อเปิดชั้นจุดเท่านั้น ~6 MB)
│   ├── (stub)/…                 แท็บอื่นในแถบนำทาง ยังไม่ได้สร้าง
│   └── globals.css              design tokens (Tailwind v4 @theme)
├── components/
│   ├── layout/TopNav.tsx
│   ├── investigate/             FilterSidebar, KpiRow, MidPanels, CitizenSignalPanel,
│   │                            CaseRail, MapPanel (ใช้ร่วมกับ /events ผ่าน controlled props)
│   ├── cases/                   CaseFilterSidebar, CaseSearchBar, CaseTable,
│   │                            CasePagination, CaseLocationMap, MediaThumb —
│   │                            ใช้ร่วมกับ /cases และ /report ผ่าน prop `basePath`
│   ├── report/                  ReportIntakeSection (ยุบ/ขยาย), ReportForm,
│   │                            ReportLocationPicker (GPS + ปักหมุด + ดาวเทียม)
│   ├── map/                     MapWorkspace — choropleth สามระดับ + อันดับพื้นที่
│   ├── events/                  EventsWorkspace (state owner), EventsFilterSidebar, EventsKpiRow,
│   │                            TimelinePanel, EventsTrendPanel, RecentPlayedPanel,
│   │                            PhenomenaSummaryPanel, InspectSummaryPanel
│   └── charts/                  SVG ล้วน ไม่มี dependency ภายนอก
├── lib/
│   ├── types.ts                 schema ของแต่ละ collection
│   ├── filters.ts               parse/serialize ตัวกรองหน้าสืบสวน/เหตุการณ์ <-> URL
│   ├── case-filters.ts          เช่นเดียวกัน แต่ของทะเบียนเคส/รายงาน (ใช้ร่วมกันทั้งสองหน้า)
│   ├── report-form.ts           ค่าคงที่ + shape ของฟอร์มแจ้งเหตุ ไม่แตะ node:fs/MongoDB
│   ├── report-schema.ts         Zod schema ของฟอร์มแจ้งเหตุ (รูปแบบ ไม่ใช่ภูมิศาสตร์)
│   ├── basemap.ts               ชั้นภาพถ่ายดาวเทียม (ปิดอยู่ตั้งแต่แรก ตั้งค่าผ่าน env)
│   ├── stats.ts                 Poisson/bucketing แบบ isomorphic — ใช้ทั้งฝั่ง server และ client
│   ├── events-replay.ts         สถิติที่ขึ้นกับตำแหน่ง playhead (client-side, ไม่ round-trip ทุก tick)
│   ├── datetime.ts              จัดรูปแบบวันที่ ตรึง timezone ไว้ที่ Asia/Bangkok
│   ├── geo.ts                   จังหวัด/อำเภอ + projection ของแผนที่
│   ├── palette.ts               สีตามประเภทเหตุการณ์
│   ├── fixtures.ts              ชุดข้อมูลตัวอย่างแบบ deterministic
│   └── mongodb.ts               connection pool + ชื่อ collection
├── server/
│   ├── shared-events.ts         loadBundle + matchedEvents (filter engine ที่ /investigate และ /events ใช้ร่วมกัน)
│   ├── investigate.ts           query + aggregate เป็น view model ของหน้าสืบสวน
│   ├── events.ts                view model ของหน้าเหตุการณ์ — facet, span, histogram, ทั้งชุดที่ตรงกับตัวกรอง
│   ├── cases.ts                 query/paginate/facet ของทะเบียนเคส (ทำใน MongoDB)
│   ├── reports.ts               listCases ล็อกไว้ที่ source src_citizen สำหรับ /report
│   └── report-intake.ts         Server Action รับฟอร์ม — ตาม protocol ใน mockup/MVP.md
└── scripts/seed.ts              seed ข้อมูลลง MongoDB
```

แผนที่และกราฟทุกตัวเขียนเป็น SVG เอง ไม่มี charting library และไม่ต้องใช้ tile server
จึงเรนเดอร์ได้เหมือนกันทุกครั้งแม้ออฟไลน์

## Data model

ทำตาม Phase 0 ใน `mockup/MVP.md` — เก็บข้อมูลดิบก่อน transform เสมอ

```
source_registry ─┐
ingestion_runs ──┼─> raw_records ──> event_candidates ──> canonical_events
processing_logs ─┘   (append-only)     (ยังเป็น claim)      (Phase 4)
```

หลักที่ล็อกไว้ตั้งแต่ database version แรก:

> **Raw data is append-only** — ห้าม AI, analyst หรือ verification process แก้ข้อมูลต้นฉบับย้อนหลัง
> ถ้าตีความใหม่ ให้สร้าง record ชั้นใหม่ที่ reference กลับมายัง raw เดิม

`scripts/seed.ts` บังคับกฎนี้ด้วย — ถ้า `raw_records` มีข้อมูลอยู่แล้วจะไม่ยอมรัน
เว้นแต่ส่ง `--force` (สำหรับ development เท่านั้น)

นอกจากนี้มี `cases` และ `citizen_reports` เพิ่มเข้ามาเพื่อรองรับแผงเคสด้านขวา
และแผงแนวโน้มรายงานจากประชาชนในหน้าสืบสวน

## ตัวกรอง

ตัวกรองฝั่งซ้ายเขียนค่าลง URL แล้วให้ server component query ใหม่ ทำให้ share ลิงก์ได้

```
/investigate?range=7d&prov=pattani,yala&type=explosion&ver=verified&trusted=1
```

| ตัวกรอง | ค่า |
| --- | --- |
| `range` | `1d` `7d` `30d` `90d` `all` |
| `prov` | `pattani` `yala` `narathiwat` `songkhla` `other` (คั่นด้วย comma) |
| `type` | `explosion` `shooting` `arson` `abduction` `raid` `unrest` `narcotics` `crime` `gang` `other` |
| `ver` | `verified` `under_review` `unverifiable` |
| `src` | source id เช่น `src_acled` |
| `trusted` | `1` = เฉพาะแหล่งที่ trust score ≥ 70 |

ตอนนี้ aggregation ทำในชั้นแอป (`src/server/investigate.ts`) ไม่ใช่ใน MongoDB
เพราะข้อมูลยังอยู่หลักพัน record — index ที่จำเป็น (`2dsphere`, `time.start`,
`provinceCode + event.type`) ถูกสร้างไว้แล้วใน `seed.ts` เมื่อข้อมูลโตค่อยย้าย
filter/aggregate ลงไปเป็น aggregation pipeline

## ทะเบียนเคส

`/cases` คือตารางของ `event_candidates` ทั้งคอลเลกชัน — หนึ่งแถวคือหนึ่งเหตุการณ์ที่ถูกบันทึกไว้
กดที่แถวเพื่อเปิด `/cases/[id]` ซึ่งแสดงระเบียนเต็มของเคสนั้น พร้อม raw record ที่มันถูกแปลงมา

ต่างจากหน้าสืบสวนตรงที่ **ทำ query/paginate/นับ facet ใน MongoDB** ไม่ได้ดึงทั้ง collection
เข้ามากรองในแอป และ **ค่าเริ่มต้นคือไม่กรองอะไรเลย** เพราะเป็นตารางไว้ค้นของทั้งหมด
ไม่ใช่ dashboard ที่ตอบคำถามเฉพาะพื้นที่

```
/cases?q=รือเสาะ&prov=narathiwat&ver=verified&media=1&sort=date&dir=desc&page=2
```

| พารามิเตอร์ | ค่า |
| --- | --- |
| `q` | คำค้น — หัวข้อ ตำบล อำเภอ จังหวัด ประเภทตามคำของแหล่งข้อมูล ผู้ก่อเหตุ หรือรหัสเคส |
| `from` / `to` | ช่วงวันที่เกิดเหตุ `YYYY-MM-DD` ตีความเป็นเวลาไทย (UTC+7) แบบรวมปลายทั้งสองข้าง |
| `prov` | `pattani` `yala` `narathiwat` `songkhla` `other` (คั่นด้วย comma) |
| `dist` | ชื่ออำเภอตามที่แหล่งข้อมูลสะกด |
| `type` | ประเภทเหตุตาม `EventType` |
| `ver` | `verified` `under_review` `unverifiable` |
| `src` | source id เช่น `src_sbpac_opendata` |
| `place` | ประเภทสถานที่ตามคำของแหล่งข้อมูล |
| `media` | `1` = เฉพาะเคสที่มีไฟล์แนบ |
| `sort` / `dir` | `date` `province` `type` `verification` `confidence` / `asc` `desc` |
| `page` | 1-based, หน้าละ 50 แถว — เกินหน้าสุดท้ายจะถูกหนีบกลับมาแทนที่จะขึ้นว่าไม่พบ |

ตัวเลือกในแถบตัวกรองมาจากข้อมูลจริงทั้งหมด (อำเภอ ประเภทสถานที่ แหล่งข้อมูล)
ไม่ได้ hardcode ไว้ และตัวเลขข้าง ๆ แต่ละตัวเลือกนับโดย**ยกตัวกรองมิติของตัวเองออก**
เลือกยะลาแล้วจังหวัดอื่นจึงยังบอกได้ว่ามีกี่รายการ

`/case` และ `/case/[id]` เป็น alias ที่ redirect มายังรูปพหูพจน์ พร้อมพาตัวกรองมาด้วย

หน้ารายเคสตั้งใจแยกให้ชัดระหว่าง "แหล่งข้อมูลรายงานว่าเป็นศูนย์" กับ "แหล่งข้อมูลไม่ได้รายงาน"
— ฟิลด์ที่ไม่มีข้อมูลขึ้นว่า *แหล่งข้อมูลไม่ได้รายงาน* และมีแผงสรุปจาก `unreported` ต่างหาก
เพราะ ศอ.บต. Open Data ไม่มีคอลัมน์ความรุนแรงหรือผู้บาดเจ็บเลย (10,037 จาก 10,041 record)
วงกลมบนแผนที่รายเคสคือขอบเขตความคลาดเคลื่อนตาม `geo_precision` ไม่ใช่จุดเกิดเหตุจริง

## รายงานจากประชาชน

`/report` ใช้ query engine ตัวเดียวกับ `/cases` (`listCases` ใน `server/cases.ts`)
ล็อกตัวกรอง `sourceId` ไว้ที่ `src_citizen` เสมอ — จึงเป็นตารางเดียวกัน กรองแคบลงมาเหลือ
เฉพาะรายงานที่ผ่านฟอร์มนี้ ไม่ใช่หน้าคนละชุด กดที่แถวจะเปิด `/cases/[id]` หน้าเดียวกับเคสอื่น

ปุ่ม **แจ้งเหตุการณ์ใหม่** ที่ด้านบนขยายฟอร์ม (`ReportForm.tsx`) ส่งเข้า Server Action
`submitCitizenReport` (`server/report-intake.ts`) ซึ่งบันทึกตาม ladder ใน `mockup/MVP.md`:

```
raw_records (เก็บสิ่งที่กรอกทั้งหมด, append-only)
     -> event_candidates (verification: "under_review" เสมอ — ยังเป็น claim)
     -> citizen_reports (ป้อนแผงแนวโน้มรายงานประชาชนใน /investigate)
```

รายละเอียดของการออกแบบ:

- **ไม่เก็บชื่อ เบอร์โทร หรืออีเมลผู้แจ้ง** — ฟอร์มไม่มีช่องให้กรอกเลย เพราะ `raw.*`
  ทั้งก้อนจะถูกแสดงตรง ๆ บนหน้ารายเคสสาธารณะ ระบบนี้ยังไม่มี auth ให้จำกัดว่าใครเห็นอะไรได้
- **พิกัดมาจาก centroid ของอำเภอที่เลือกเสมอ** (`geo_precision: "district"`) — ไม่มีการปักหมุด
  GPS ผู้แจ้งเลือกจากรายชื่ออำเภอจริงเท่านั้น (validate กับ `districtsOfProvince`) ป้องกันพิกัดหลุด
- **`content_hash` คำนวณจากเนื้อหาล้วน ๆ** ไม่ผสม id สุ่มใด ๆ — ส่งฟอร์มเดิมซ้ำ (เช่น
  double-click) จะชนกับ record เดิมและได้ case เดิมกลับมา แทนที่จะสร้างซ้ำ
- **honeypot field** (`organization`, ซ่อนจากคนจริงด้วย CSS ไม่ใช่แค่ `hidden`) — ถ้าถูกกรอก
  จะตอบว่าสำเร็จแต่ไม่บันทึกอะไรเลย
- ลิงก์หลักฐานต้องเป็น `http://`/`https://` เท่านั้น (validate ด้วย `new URL()`) กัน
  `javascript:` URL ที่จะรันได้ตอนกดลิงก์บนหน้ารายเคส
- แหล่งข้อมูล `src_citizen` (`trust.score: 35`, ต่ำกว่าเกณฑ์ trusted ที่ 70) ถูกลงทะเบียนเอง
  ด้วย `$setOnInsert` ตอนมีรายงานแรกเข้ามา — ไม่ต้องรัน `db:seed --force` เพื่อเปิดใช้ฟีเจอร์นี้

## เหตุการณ์

`/events` ตาม `mockup/page เหตุการณ์.png` — ตัวกรองเดียวกับ `/investigate` (`InvestigationFilters`
ใน `lib/filters.ts`) แต่แสดงเป็นไทม์ไลน์เล่นย้อนหลังแทนแดชบอร์ดภาพรวม ข้อมูลจริงในระบบนี้ทุก
record เป็น `event.type: "unrest"` และไม่มี severity/casualties เกือบทั้งหมด (ดู `## Data model`)
— ทุก panel จึงต้องรองรับ "ไม่มีอะไรน่าสนใจในช่วงนี้" เป็นคำตอบที่ถูกต้อง ไม่ใช่ error

สถาปัตยกรรม: server ส่ง `EventFeatureCollection` ที่ตรงกับตัวกรองมาครั้งเดียว (เรียงตามเวลา)
พร้อม facet count, ช่วงวันที่เต็ม และ histogram ทั้งชุด — ทุกอย่างที่ขึ้นกับตำแหน่ง playhead
(จำนวนที่เล่นไปแล้ว, ความหนาแน่น, คลัสเตอร์เสี่ยง, เส้นทางเวลา, สรุปปรากฏการณ์, แถบไฮไลต์บนกราฟ
แนวโน้ม) คำนวณฝั่ง client ล้วน (`lib/events-replay.ts`) เพื่อให้ลาก scrubber แล้วลื่นจริง ไม่ใช่
round-trip ไป MongoDB ทุก tick

- **`server/shared-events.ts`** คือ query engine ที่แยกออกมาจาก `investigate.ts` เดิม (`loadBundle`,
  `matchedEvents` แบบรองรับ "ยกตัวกรองมิติหนึ่งออก" เหมือน `cases.ts`) ให้ทั้งสองหน้าใช้ร่วมกัน —
  ไม่มีการเปลี่ยนพฤติกรรมของ `/investigate` ตรงนี้เป็น pure extraction ตรวจสอบแล้วว่าตัวเลขตรงกันทุกตัว
- **เส้นทางเวลา** (เส้นประเชื่อมเหตุการณ์ตามลำดับ) จำกัดเฉพาะเหตุการณ์ล่าสุด ~20 รายการ ภายใน ~90 วัน
  จาก playhead เท่านั้น — ไม่ใช่ทั้ง 10,000+ จุด ซึ่งจะพันกันจนอ่านไม่ออก
- **คลัสเตอร์เสี่ยงสูง/ปานกลาง** ใช้ Poisson significance test ตัวเดียวกับ hotspot ของรายงาน
  ประชาชนใน `/investigate` (สรุปรวมเป็น `detectHotspots` ใน `lib/stats.ts`) จุดวางไว้ที่ centroid ของ
  พิกัดเหตุการณ์จริงในอำเภอนั้น ไม่ใช่ centroid ของขอบเขตปกครอง เพราะ `location.district` เป็น
  free text ต่างกันไปตามแหล่งข้อมูล (บาง UCDP record เป็นชื่ออังกฤษ) จึง join กับโพลีกอนไม่ปลอดภัย
- **สรุปปรากฏการณ์** สร้างจากคลัสเตอร์ที่มีนัยสำคัญทางสถิติเท่านั้น ไม่มีการเรียก LLM ใด ๆ — ไม่พบ
  รูปแบบที่มีนัยสำคัญคือคำตอบที่ถูกต้องเมื่อไม่มี ไม่ใช่ error
- **ความหนาแน่นเหตุการณ์** เทียบอัตราในช่วง 180 วันล่าสุดกับอัตราเฉลี่ยระยะยาวของชุดข้อมูลเอง
  (ไม่มีค่าคงที่ผูกกับขนาด 10,041 record วันนี้) คะแนน 100 หมายถึง "สูงเป็น 2 เท่าของค่าเฉลี่ยระยะยาว"
- **"Inspect Summary"** (แผงขวา) แทนที่ช่องเอนทิตี (บุคคล/กลุ่ม/ยานพาหนะ/โทรศัพท์) ในต้นแบบด้วย
  ฟิลด์ที่มีอยู่จริง (แหล่งข้อมูลยืนยัน, หลักฐานแนบ, ผู้ก่อเหตุ/เป้าหมายที่ระบุ) เพราะ `event_candidates`
  ไม่มีการสกัด entity ประเภทนั้นเลย
- `MapPanel.tsx` รองรับ "controlled mode" เพิ่มเข้ามาแบบ additive (`currentTimestamp`,
  `onTimestampChange`, `onHoverFeature` ฯลฯ) — `/investigate` ที่ไม่ส่ง prop เหล่านี้ยังทำงาน
  เหมือนเดิมทุกประการ (ยืนยันด้วยการเทียบ output ก่อน/หลัง)

## ข้อจำกัดที่พบในเครื่องนี้

`npm run build` **ใช้ไม่ได้บนไดรฟ์ D:** เพราะ D: เป็น **exFAT** ซึ่งไม่รองรับ symlink
Windows จึงคืน `EISDIR` จาก `readlink()` แทน `EINVAL` ที่ตัว resolver ของ Next.js คาดไว้

```
Error: EISDIR: illegal operation on a directory, readlink 'D:\...\src\app\page.tsx'
```

ตรวจสอบได้ว่าเป็นปัญหาระดับ filesystem ไม่ใช่โค้ด:

```bash
node -e "try{require('fs').readlinkSync('package.json')}catch(e){console.log(e.code)}"
# บน D: (exFAT) -> EISDIR     บน C: (NTFS) -> EINVAL  <- ค่าที่ถูกต้อง
```

`npm run dev` และ `npm run typecheck` ยังทำงานได้ปกติ
ถ้าต้อง build จริงให้ย้าย repo ไปไว้บนไดรฟ์ NTFS (C:)

> ไฟล์ในโปรเจกต์นี้ต้องเป็น **UTF-8** — ถ้าแก้ไฟล์ที่มีภาษาไทยด้วย PowerShell
> ให้ใส่ `-Encoding utf8` เสมอ ไม่งั้นจะกลายเป็น UTF-16 แล้วอ่านไม่ออก

## ที่ยังไม่ได้ทำ

- แท็บที่เหลือในแถบนำทาง (เครือข่าย / แผนที่ / แหล่งข้อมูล / สมมติฐาน) ยังเป็น stub
- คอลเลกชัน `cases` ยังว่าง — ทะเบียนเคสจึงอ่านจาก `event_candidates` โดยถือหนึ่งเหตุการณ์
  เป็นหนึ่งเคส ส่วน `buildCases()` ใน `fixtures.ts` เป็นข้อมูลสมมติที่ `seed.ts` ไม่ได้เขียนลง DB
- Connector จริง (DSW / ACLED / UCDP) — ตอนนี้มีแต่ fixtures
- `canonical_events` + event resolution (Phase 4) และ verification engine (Phase 5)
