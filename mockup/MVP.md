ได้ครับ ผมเสนอให้ **ยังไม่รีบทำ Claim/Verified Fact/ML** แต่สร้าง “Data Lake แบบ NoSQL” ให้ดึงข้อมูลทุกแหล่งเข้ามาโดยไม่ทำลายข้อมูลต้นฉบับก่อน แล้วค่อยสร้าง processing layer ทับอีกชั้นหนึ่ง

## Architecture ระยะแรก

```text
                PUBLIC DATA SOURCES
                        │
        ┌───────────────┼────────────────┐
        │               │                │
      DSW          Government          External
                  ISOC / Police       ACLED / UCDP
        │               │                │
        └───────────────┼────────────────┘
                        ↓
                 [ Connectors ]
            API / Scraper / Dataset
                        ↓
                [ RAW INGESTION ]
                        ↓
              MongoDB / Document DB
                        │
              ┌─────────┴─────────┐
              ↓                   ↓
        raw_records          ingestion_runs
              │
              ↓
        Normalization
              │
              ↓
       event_candidates
              │
              ↓
       Dedup / Resolution
              │
              ↓
     canonical_events
```

หัวใจสำคัญคือ **ข้อมูลจากต้นทางต้องถูกเก็บก่อน transform เสมอ**

---

# 1. Database ที่แนะนำ

สำหรับช่วงแรกผมเลือก **MongoDB** มากกว่า relational database เพราะข้อมูลแต่ละแหล่งมี schema ต่างกันมาก และเรายังอยู่ในช่วง discovery

```text
MongoDB
└── palantir_th
      │
      ├── source_registry
      ├── ingestion_runs
      ├── raw_records
      ├── event_candidates
      ├── canonical_events
      └── processing_logs
```

MongoDB ยังรองรับ GeoJSON / `2dsphere` ซึ่งจะมีประโยชน์มากเมื่อเริ่มวิเคราะห์เหตุการณ์ตามพื้นที่

```json
{
  "location": {
    "type": "Point",
    "coordinates": [101.25, 6.87]
  }
}
```

---

# 2. `source_registry`

เริ่มจากทำทะเบียน source ทั้งหมดก่อน

```json
{
  "_id": "src_acled",

  "name": "ACLED",
  "category": "conflict_event",
  "priority": "P1",

  "connector": {
    "type": "REST_API",
    "endpoint": "ACLED_API"
  },

  "schedule": {
    "mode": "incremental",
    "frequency": "daily"
  },

  "trust": {
    "class": "external_dataset"
  },

  "enabled": true
}
```

ตัวอย่าง source registry

| source_id          | Source           | Connector       | Mode                   |
| ------------------ | ---------------- | --------------- | ---------------------- |
| `src_dsw`          | Deep South Watch | Dataset/Scraper | snapshot + incremental |
| `src_isoc4`        | กอ.รมน.ภาค 4 สน. | Web scraper     | incremental            |
| `src_police_south` | ศปก.ตร.สน.       | Web scraper     | incremental            |
| `src_acled`        | ACLED            | REST API        | incremental            |
| `src_ucdp`         | UCDP             | API / CSV       | versioned dataset      |
| `src_gtd`          | GTD              | dataset         | historical             |

ข้อดีคือภายหลังเพิ่ม

```text
ThaiPBS
BBC Thai
Matichon
Facebook Page
Citizen Report
Sensor
Manual Entry
```

ได้โดยไม่เปลี่ยน architecture

---

# 3. Collection สำคัญที่สุด: `raw_records`

**ห้าม normalize ตอน ingestion**

ข้อมูลที่ได้รับจาก source ให้เก็บเกือบทั้งหมดตามต้นฉบับ

ตัวอย่าง ACLED:

```json
{
  "_id": "raw_acled_TH_123456",

  "source_id": "src_acled",

  "external_id": "THA123456",

  "retrieved_at": "2026-08-24T08:30:22Z",

  "source": {
    "url": "...",
    "published_at": "2026-08-23"
  },

  "raw": {
    "event_id_cnty": "...",
    "event_date": "...",
    "event_type": "...",
    "actor1": "...",
    "location": "...",
    "latitude": "...",
    "longitude": "...",
    "fatalities": "..."
  },

  "integrity": {
    "content_hash": "sha256:..."
  },

  "processing": {
    "status": "pending"
  }
}
```

เหตุผลที่ต้องมี `raw`

สมมติอีก 6 เดือนพบว่า

```text
actor2
```

มีประโยชน์ต่อ ML

ถ้าเราเลือกเก็บเฉพาะ field ที่คิดว่าสำคัญวันนี้ ข้อมูลนั้นอาจหายไปแล้ว

แต่ถ้ามี Raw Layer สามารถ

```text
reprocess
re-normalize
re-train
```

ได้ทั้งหมด

---

# 4. เก็บ `content_hash`

ทุก record ควรสร้าง SHA-256

```text
SHA256(
 source
 + source_record_id
 + raw_content
)
```

เช่น

```json
"integrity": {
    "sha256": "833fa..."
}
```

มันช่วยตรวจ

```text
duplicate
source modification
scraper duplicate
dataset revision
```

ได้

---

# 5. `ingestion_runs`

ทุกครั้งที่ crawler/API ทำงาน ต้องมี run record

```json
{
  "_id": "run_20260824_acled_001",

  "source_id": "src_acled",

  "started_at": "2026-08-24T08:00:00Z",
  "finished_at": "2026-08-24T08:01:22Z",

  "status": "success",

  "records": {
    "downloaded": 128,
    "new": 12,
    "updated": 3,
    "duplicate": 113,
    "failed": 0
  }
}
```

อันนี้สำคัญมากสำหรับ observability

Dashboard จะตอบได้ทันทีว่า

> “วันนี้ข้อมูลตำรวจไม่เข้าเพราะไม่มีเหตุการณ์ หรือเพราะ scraper พัง?”

สองอย่างนี้ต่างกันมาก

---

# 6. Connector แต่ละ Source

ผมจะแยก connector ไม่ให้ logic ปนกัน

```text
/connectors

   /dsw
      fetch.py
      parser.py

   /isoc
      fetch.py
      parser.py

   /police
      fetch.py
      parser.py

   /acled
      client.py
      parser.py

   /ucdp
      client.py
      parser.py
```

แล้วทุก connector ส่งออก interface เดียว

```python
RawRecord(
    source_id,
    external_id,
    retrieved_at,
    raw,
    source_url
)
```

ดังนั้น downstream ไม่สนว่า source มาจาก

```text
HTML
JSON
CSV
Excel
API
```

---

# 7. วิธีดึงแต่ละแหล่ง

## DSW — Initial Historical Backbone

เริ่มจาก DSW ก่อน

DSW CID มี codebook ที่กำหนดโครงสร้างเหตุการณ์ เช่น incident detail, event type, cause, actor และ property damage อยู่แล้ว จึงเหมาะกับ historical bootstrap ของ database มากที่สุด ([DeepSouthWatch.org][1])

Pipeline:

```text
DSW Dataset
     ↓
download
     ↓
archive original file
     ↓
parse rows
     ↓
raw_records
```

ยังไม่ควร map field ทิ้งทันที

เก็บ

```json
{
  "raw": {...},
  "dataset_version": "...",
  "codebook_version": "5.5.9"
}
```

ไว้ด้วย

---

# 8. ACLED — API Connector

ACLED รองรับ OAuth สำหรับ programmatic access โดย access token มีอายุ 24 ชั่วโมง และ API รองรับ JSON/CSV รวมถึง pagination ([ACLED][2])

ผมจะแนะนำ query เฉพาะประเทศไทยก่อน

```text
country = Thailand
```

แล้วค่อย filter geography ในระบบเราเอง

เช่น

```text
Pattani
Yala
Narathiwat
Songkhla
```

อย่า filter แคบเกินไปตั้งแต่ ingestion เพราะเหตุการณ์บางรายการอาจมี geographic coding ไม่ตรงกับที่เราคาด

อีกเรื่องที่ควรออกแบบตั้งแต่ตอนนี้:

**ACLED ประกาศว่า 1 October 2026 จะเปลี่ยนการ pagination หลายประเภทไปใช้ cursor-based pagination** ([ACLED][3])

ตอนนี้คือ 24 สิงหาคม 2026 ดังนั้นผมจะเขียน connector ใหม่โดยรองรับ cursor-based pagination ตั้งแต่ต้น แทนการสร้างระบบใหม่บน `page=1, page=2...` แล้วต้อง migrate อีกไม่นาน

---

# 9. UCDP

UCDP ให้ทั้ง API และ downloadable datasets และ Candidate GED มี release ต่อเนื่องเหมาะกับการใช้เป็น external validation source ([UCDP][4])

Pipeline:

```text
UCDP API
    ↓

retrieve version

    ↓

raw_records

{
 dataset: "candidate_ged",
 dataset_version: "...",
 ...
}
```

**อย่า overwrite version เก่า**

เช่น

```text
Event X
Candidate v1
Candidate v2
GED final
```

ควรอยู่ครบ

เพราะเราจะสามารถวิเคราะห์ภายหลังได้ว่า

> ข้อมูลเหตุการณ์หนึ่งเปลี่ยนแปลงอย่างไรเมื่อหลักฐานเพิ่มขึ้น

ซึ่งมีคุณค่ามากกับระบบ intelligence

---

# 10. Government Web Scraper

สำหรับ

```text
กอ.รมน.ภาค 4 สน.
ศปก.ตร.สน.
ตำรวจ
```

ใช้

```text
Scheduler
   ↓
Listing crawler
   ↓
Discover URL
   ↓
Article crawler
   ↓
HTML snapshot
   ↓
raw_records
```

อย่าเก็บเฉพาะ extracted text

ควรเก็บอย่างน้อย

```json
{
  "url": "...",

  "title": "...",

  "published_at": "...",

  "html_hash": "...",

  "content": "...",

  "retrieved_at": "...",

  "http": {
      "status": 200
  }
}
```

เพราะหน้าเว็บสามารถแก้ย้อนหลังได้

---

# 11. Scheduling

MVP ผมใช้ประมาณนี้

| Source         |          Initial import |                                    Incremental |
| -------------- | ----------------------: | ---------------------------------------------: |
| DSW            |            Full history |                             Daily/weekly check |
| กอ.รมน.        | Full accessible archive |                                ทุก 1–3 ชั่วโมง |
| Police         | Full accessible archive |                                ทุก 1–3 ชั่วโมง |
| ACLED          |   Full Thailand history |                                          Daily |
| UCDP Candidate |        Relevant history | ตรวจ release daily / ingest เมื่อ version ใหม่ |
| GTD            |   Full relevant history |                                ไม่ต้อง polling |

ไม่จำเป็นต้อง scrape ทุก 5 นาที เพราะไม่ได้เพิ่ม value มาก และสร้าง load ให้ต้นทางโดยไม่จำเป็น

ควรเคารพ robots.txt, Terms of Use และ rate limit ของแต่ละแหล่งด้วย

---

# 12. แล้วค่อยสร้าง `event_candidates`

เมื่อ Raw Database เริ่มมีข้อมูลแล้ว เราจึงทำ

```text
raw_records
       ↓
   Extractor
       ↓
Normalizer
       ↓
event_candidates
```

schema กลาง:

```json
{
  "_id": "candidate_xxx",

  "source_id": "src_acled",
  "raw_record_id": "raw_xxx",

  "time": {
    "start": "...",
    "precision": "day"
  },

  "location": {
    "province": "ปัตตานี",
    "district": "หนองจิก",

    "geo": {
      "type": "Point",
      "coordinates": [
        101.18,
        6.84
      ]
    }
  },

  "event": {
    "type": "explosion"
  },

  "actors": [],

  "targets": [],

  "casualties": {
    "killed": 0,
    "injured": 2
  }
}
```

ตรงนี้ยังเป็น

> **Candidate**

ไม่ใช่ Fact

---

# 13. Data Flow ที่ผมแนะนำ

```text
                        Internet
                           │
             ┌─────────────┼─────────────┐
             │             │             │
            API           HTML         Dataset
             │             │             │
             └─────────────┼─────────────┘
                           ↓
                    Connector Layer
                           ↓
                    ┌──────────────┐
                    │ RAW DATABASE │
                    │ immutable    │
                    └──────┬───────┘
                           ↓
                       Parser
                           ↓
                      Normalizer
                           ↓
                  event_candidates
                           ↓
                    Event Matching
                           ↓
                   canonical_event
                           ↓
                 Claim Extraction
                           ↓
                    Verification
                           ↓
                         Fact
                           ↓
                   Derived Signals
                           ↓
                     Hypothesis
```

นี่ทำให้ protocol ที่เราต้องการยังอยู่ครบ:

```text
RAW
 ↓
CLAIM
 ↓
VERIFIED FACT
 ↓
DERIVED
 ↓
HYPOTHESIS
```

---

# 14. ลำดับการทำจริงที่ผมแนะนำ

**Phase 0 — Database Foundation**

```text
MongoDB
source_registry
ingestion_runs
raw_records
```

ก่อน

**Phase 1 — Historical bootstrap**

```text
DSW
ACLED
UCDP
```

เอาข้อมูลอดีตลงให้ได้ก่อน

**Phase 2 — Live collectors**

```text
กอ.รมน.
ตำรวจ
DSW updates
```

**Phase 3 — Normalization**

```text
raw_records
→ event_candidates
```

**Phase 4 — Event Resolution**

เช่น

```text
DSW#9392 ──────┐
ACLED#THA123 ──┤
Police#8821 ───┼── EV-2026-000182
ISOC#2291 ─────┘
```

**Phase 5 — Verification Engine**

ค่อยเริ่ม

```text
Claim
Verified Fact
Derived
Hypothesis
```

---

## MVP ที่ควรสร้างก่อน

ผมจะ **ไม่เริ่มจาก scraper 6 ตัวพร้อมกัน**

เริ่มเพียง:

```text
MongoDB
   │
   ├── source_registry
   ├── ingestion_runs
   └── raw_records

Connectors
   │
   ├── DSW importer
   ├── ACLED API
   └── UCDP importer
```

ให้สามตัวนี้ทำ **Historical Conflict Database** ให้ได้ก่อน

แล้วค่อยเพิ่ม

```text
ISOC Scraper
Police Scraper
News Scraper
Citizen Report
```

ข้อดีคือภายใน architecture เดียวกัน เราจะค่อย ๆ เปลี่ยนจาก **“ฐานข้อมูลเหตุการณ์” → “ฐานข้อมูลหลักฐาน”** ซึ่งเหมาะกับการวิเคราะห์ความเชื่อมโยงในระยะต่อไปมากกว่าแค่สะสมข่าว

และมีหลักหนึ่งที่ผมจะล็อกไว้ตั้งแต่ database version แรก:

> **Raw data is append-only. ห้าม AI, analyst หรือ verification process แก้ข้อมูลต้นฉบับย้อนหลัง**

ถ้าตีความใหม่ ให้สร้าง record ชั้นใหม่ที่ reference กลับมายัง Raw เดิมเสมอ นี่จะกลายเป็น foundation สำคัญที่สุดของระบบเมื่อเราเริ่มทำ Data Science, Graph Analysis และ ML ต่อไปครับ

[1]: https://deepsouthwatch.org/sites/default/files/2025/codebook/CID_Codebook-5-thai.pdf?utm_source=chatgpt.com "คู่มือลงรหัส"
[2]: https://acleddata.com/api-documentation/getting-started?utm_source=chatgpt.com "Getting started | ACLED"
[3]: https://acleddata.com/api-documentation/elements-acleds-api?utm_source=chatgpt.com "Elements of ACLED’s API | ACLED"
[4]: https://ucdp.uu.se/downloads/?utm_source=chatgpt.com "UCDP Dataset Download Center"
