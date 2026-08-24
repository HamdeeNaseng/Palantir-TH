# Palantir-TH Commit Protocol

เอกสารนี้กำหนดกติกาการเปลี่ยนแปลงโค้ดและข้อมูลของ Palantir-TH เพื่อให้โครงการโอเพนซอร์สตรวจสอบย้อนกลับได้ ปลอดภัย และไม่ทำลาย backbone โดยไม่ตั้งใจ

## 1. หลักการ

1. ทุกการเปลี่ยนแปลงต้องมีเหตุผล ขอบเขต และวิธีตรวจสอบที่ชัดเจน
2. หนึ่ง commit ควรทำหนึ่งเรื่องและสามารถ revert ได้อย่างปลอดภัย
3. ห้าม push เข้า `main` โดยตรง ทุกการเปลี่ยนแปลงต้องผ่าน Pull Request (PR)
4. ห้าม commit secret, token, `.env`, ข้อมูลส่วนบุคคล, ข้อมูลคดีที่ไม่เปิดเผย หรือ raw dataset ที่ไม่มีสิทธิ์เผยแพร่
5. การเปลี่ยน schema, API contract หรือ data pipeline ต้องรองรับข้อมูลเดิม หรือมี migration และ rollback plan
6. ข้อมูลจากภายนอกต้องระบุแหล่งที่มา เงื่อนไขการใช้งาน และเวลาที่ดึงข้อมูลเสมอ

## 2. ส่วนที่ถือเป็น Backbone

การเปลี่ยนแปลงต่อไปนี้มีความเสี่ยงสูงและต้องได้รับการ review อย่างน้อย 2 คน โดยอย่างน้อย 1 คนต้องเป็น code owner ของส่วนนั้น

- Database schema, index และ migration
- `source_registry`, `raw_records`, `ingestion_runs` และ `event_candidates`
- Connector, scraper, scheduler และขั้นตอน deduplication
- `content_hash`, source identity และ provenance
- Public API, shared types และ validation rules
- Authentication, authorization, audit log และ secret management
- Dependency, build, deployment และ CI/CD configuration
- License, privacy, retention policy และ security policy

Backbone change ห้าม merge หากไม่มี test/verification, migration plan และ rollback plan ที่เหมาะสมกับความเสี่ยง

## 3. Branch Naming

สร้าง branch จาก `main` ที่เป็นปัจจุบัน และใช้ชื่อแบบต่อไปนี้

```text
feat/<issue>-short-name
fix/<issue>-short-name
data/<issue>-source-name
docs/<issue>-short-name
refactor/<issue>-short-name
security/<issue>-short-name
hotfix/<issue>-short-name
```

ตัวอย่าง:

```text
feat/42-event-search
data/57-acled-connector
fix/61-content-hash-collision
```

ห้ามใช้ branch เดียวทำหลาย issue ที่ไม่เกี่ยวข้องกัน

## 4. Commit Message

ใช้รูปแบบ Conventional Commits:

```text
<type>(<scope>): <summary>

<body>

<footer>
```

### Type ที่อนุญาต

| Type | ใช้เมื่อ |
| --- | --- |
| `feat` | เพิ่มความสามารถใหม่ |
| `fix` | แก้ข้อผิดพลาด |
| `data` | เพิ่มหรือแก้ connector, dataset หรือ mapping |
| `schema` | เปลี่ยน schema, index หรือ migration |
| `security` | แก้ความปลอดภัยหรือ privacy |
| `refactor` | ปรับโครงสร้างโดยไม่เปลี่ยนพฤติกรรม |
| `perf` | ปรับประสิทธิภาพ |
| `test` | เพิ่มหรือแก้ test |
| `docs` | แก้เอกสารเท่านั้น |
| `build` | แก้ dependency หรือ build system |
| `ci` | แก้ CI/CD |
| `chore` | งานบำรุงรักษาที่ไม่เข้ากลุ่มอื่น |
| `revert` | ย้อนการเปลี่ยนแปลงเดิม |

Scope ควรสะท้อนพื้นที่ เช่น `ui`, `api`, `db`, `ingestion`, `acled`, `ucdp`, `dsw`, `auth` หรือ `deps`

Summary ใช้ imperative mood, ไม่เกิน 72 ตัวอักษร และไม่ลงท้ายด้วยจุด

ตัวอย่าง:

```text
feat(events): add province and date filters

data(acled): preserve source event id during ingestion

schema(raw-records)!: require content hash and fetched timestamp

BREAKING CHANGE: existing records must be backfilled before deployment.
Migration: scripts/migrations/2026-08-backfill-content-hash.ts
Rollback: restore the previous validator after removing backfilled fields.
Refs: #57
```

การเปลี่ยนแปลงที่ไม่ backward-compatible ต้องใส่ `!` หลัง type/scope และ footer `BREAKING CHANGE:`

## 5. Commit Requirements

ก่อน commit:

- ตรวจ diff ให้ไม่มี secret, credential, debug dump หรือข้อมูลอ่อนไหว
- ห้ามใช้ `--no-verify` เพื่อข้าม hook ยกเว้นเหตุฉุกเฉินที่บันทึกเหตุผลใน PR
- ใช้ lockfile เดียวกับ package manager ของโครงการ (`package-lock.json`)
- dependency update ต้องแยกจาก feature เมื่อทำได้
- generated file หรือ dataset ขนาดใหญ่ต้องไม่เข้า Git; ใช้ storage/release artifact ที่ได้รับอนุมัติ
- commit ต้องมี DCO sign-off ด้วย `git commit -s`

ข้อความท้าย commit ต้องมีรูปแบบ:

```text
Signed-off-by: Full Name <email@example.com>
```

การ sign-off หมายถึงผู้ส่งยืนยันว่ามีสิทธิ์นำ contribution นี้เข้าสู่โครงการภายใต้ license ของโครงการ

## 6. Local Quality Gates

ก่อนเปิด PR ต้องรันจาก clean install:

```bash
npm ci
npm run typecheck
npm run build
```

เมื่อโครงการมี lint และ automated tests ที่ใช้งานได้ใน CI แล้ว ทั้งสองรายการต้องผ่านด้วย การแก้ bug ควรเพิ่ม regression test ที่ล้มเหลวก่อนแก้และผ่านหลังแก้

สำหรับการเปลี่ยน data pipeline ต้องตรวจเพิ่มอย่างน้อย:

- ingest ซ้ำแล้วไม่สร้างข้อมูลซ้ำโดยไม่ตั้งใจ
- source ID และ `content_hash` คงที่ตาม contract
- เก็บ raw payload แบบ immutable
- บันทึก `source_url`, `fetched_at`, connector version และ run ID
- failure บางรายการไม่ทำให้ทั้ง batch สูญหาย
- retry ไม่เปลี่ยนผลลัพธ์ที่สำเร็จแล้ว

## 7. Pull Request Protocol

PR ต้องมีขนาดเล็กพอที่จะ review ได้ และต้องระบุ:

```markdown
## Why
ปัญหาหรือเหตุผลของการเปลี่ยนแปลง

## What
สิ่งที่เปลี่ยนและสิ่งที่ตั้งใจไม่เปลี่ยน

## Verification
คำสั่งที่รันและผลลัพธ์ รวมถึง screenshot สำหรับ UI

## Data and security impact
แหล่งข้อมูล, license/ToS, PII, secret และ threat ที่เกี่ยวข้อง หรือระบุว่าไม่มี

## Migration and rollback
ขั้นตอน deploy, migration และ rollback หรือระบุว่าไม่จำเป็น

## Related issue
Closes #<issue>
```

กติกาการอนุมัติ:

- PR ปกติ: review อย่างน้อย 1 คน
- Backbone/security/privacy change: review อย่างน้อย 2 คนและ code owner 1 คน
- ผู้เขียน PR ห้ามเป็นผู้อนุมัติคนเดียว
- comment ที่เป็น blocking ต้องถูกแก้หรือ resolve พร้อมเหตุผล
- CI ต้องผ่านและ branch ต้องไม่ conflict กับ `main`
- หลัง approval หากมีการแก้ logic สำคัญ ต้องขอ review ใหม่

## 8. Merge and History

- ใช้ **Squash and merge** เป็นค่าเริ่มต้น
- ชื่อ squash commit ต้องเป็น Conventional Commit และอ้างอิง issue/PR
- final commit ต้องมี DCO sign-off ของผู้ส่ง contribution
- ห้าม force-push ไป `main` และ release branch
- branch protection ต้องบังคับ PR, required reviews, required status checks, conversation resolution และป้องกัน branch deletion
- ลบ feature branch หลัง merge เพื่อลด branch ที่หมดอายุ

ใช้ merge commit ได้เฉพาะ release branch หรือกรณีที่ต้องรักษาประวัติหลาย commit โดย maintainer อธิบายเหตุผลใน PR

## 9. Data Source Protocol

เมื่อเพิ่มหรือเปลี่ยน datasource ต้องแนบข้อมูลต่อไปนี้ใน PR:

- ชื่อเจ้าของข้อมูลและ URL ทางการ
- วิธีเข้าถึง: API, download, request หรือ scrape
- License, Terms of Service และข้อจำกัดการเผยแพร่
- เขตข้อมูลที่นำเข้าและ mapping เข้าสู่ canonical schema
- timezone, ภาษา, encoding และความถี่การอัปเดต
- rate limit, retry/backoff และ user-agent/contact เมื่อ scrape
- ตัวอย่าง fixture ที่ลดทอนข้อมูลและไม่มี PII
- วิธีตรวจจับ source เปลี่ยนรูปแบบหรือหยุดให้บริการ

ห้าม bypass access control, CAPTCHA หรือข้อจำกัดของผู้ให้บริการ หากไม่มีสิทธิ์แจกจ่าย raw data ให้เก็บเฉพาะ metadata/provenance ที่ license อนุญาต และให้ผู้ใช้ดึงข้อมูลด้วย credential ของตนเอง

## 10. Schema and API Changes

- ใช้ additive change ก่อน destructive change
- แยกขั้นตอน expand → migrate/backfill → switch readers → contract
- migration ต้อง idempotent และมี dry-run เมื่อเกี่ยวข้องกับข้อมูลจำนวนมาก
- ห้ามแก้ข้อมูล production ด้วยคำสั่ง manual ที่ไม่มี script หรือ audit trail
- public API ต้อง version เมื่อไม่สามารถรักษา backward compatibility
- shared type ต้องมี validation ที่ runtime บริเวณ trust boundary
- deprecation ต้องประกาศใน release notes พร้อมกำหนดเวลาถอดออก

## 11. Security and Privacy

ห้ามเปิด public issue หรือ PR ที่มีรายละเอียดช่องโหว่ซึ่งยังแก้ไม่เสร็จ ให้รายงานผ่านช่องทาง private security reporting ของ repository

หากพบ secret ใน commit:

1. หยุดใช้ secret และ rotate/revoke ทันที
2. แจ้ง maintainer ผ่านช่องทาง private
3. ลบ secret จาก code และ history ตามแผน incident response
4. ตรวจ log เพื่อประเมินการนำ secret ไปใช้
5. บันทึกเหตุการณ์โดยไม่เผยแพร่ค่าของ secret

ข้อมูลบุคคลและข้อมูลคดีต้องใช้หลัก data minimization, purpose limitation, access control และ retention policy ก่อนนำเข้า

## 12. Dependencies and Supply Chain

- ใช้ dependency เท่าที่จำเป็นและตรวจ license ก่อนเพิ่ม
- pin เวอร์ชันผ่าน lockfile และ review install scripts
- dependency PR ต้องระบุผลกระทบ breaking/security และผ่าน build
- ห้าม merge package ที่เลิกดูแลหรือมีช่องโหว่ระดับสูงโดยไม่มี mitigation ที่บันทึกไว้
- release tag และ commit ของ maintainer ควรลงลายเซ็นแบบ cryptographic
- artifact ที่เผยแพร่ควรสร้างจาก CI และผูกกับ commit SHA ที่ตรวจสอบได้

## 13. Release Protocol

ใช้ Semantic Versioning:

- `MAJOR`: breaking API/schema behavior
- `MINOR`: feature ใหม่ที่ backward-compatible
- `PATCH`: bug/security fix ที่ backward-compatible

ทุก release ต้องมี changelog, migration note, known issues, dependency/security note และ commit SHA ห้าม deploy migration ที่ถอยกลับไม่ได้โดยไม่มี backup และ restore test

## 14. Emergency Hotfix

เหตุฉุกเฉินอนุญาตให้ลด reviewer เหลือ maintainer 1 คนได้เฉพาะเมื่อระบบล่ม ข้อมูลเสี่ยงเสียหาย หรือมีช่องโหว่ที่กำลังถูกโจมตี โดยต้อง:

1. ใช้ branch `hotfix/<issue>-short-name`
2. จำกัด diff ให้เล็กที่สุด
3. ผ่าน quality gates ที่เกี่ยวข้อง
4. มี rollback command หรือ feature flag
5. เปิด post-incident PR ภายใน 48 ชั่วโมงเพื่อเพิ่ม test, เอกสาร และ review ที่ขาดไป

กฎห้าม commit secret และห้ามทำลายข้อมูลโดยไม่มี backup ยังคงใช้เสมอ

## 15. Repository Settings Checklist

Maintainer ควรเปิดใช้:

- Branch protection สำหรับ `main`
- Required PR reviews และ CODEOWNERS
- Required CI checks
- DCO check
- Secret scanning และ push protection
- Dependency vulnerability alerts และ automated update PR
- Code scanning/SAST
- Private vulnerability reporting
- Signed release tags
- Issue/PR templates และ `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`

## Definition of Done

งานถือว่าเสร็จเมื่อ code, test, documentation, migration และ operational impact สอดคล้องกันทั้งหมด ไม่ใช่เพียงเมื่อ build ผ่าน ผู้ review ต้องสามารถตอบได้ว่า “เปลี่ยนอะไร ทำไมปลอดภัย ตรวจสอบอย่างไร และย้อนกลับอย่างไร” จาก PR เพียงแห่งเดียว
