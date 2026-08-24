/**
 * Incrementally ingest sources declared in mockup/API & Datasource Sets.md.
 * No generated incidents are used: public pages are archived as received,
 * credentialed APIs run only with credentials, and licensed datasets run only
 * from an explicitly supplied local file.
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { MongoClient, type Collection, type Db } from "mongodb";
import {
  readLatestArchive,
  writeArchive,
  type ArchivedPayload,
} from "./lib/raw-archive";
import { districtsOfProvince, representativePoint } from "../src/lib/geography";
import { PROVINCES } from "../src/lib/geo";
import type {
  EventCandidateDoc,
  EventType,
  GeoPrecision,
  IngestionRunDoc,
  ProvinceCode,
  SeverityLevel,
  SourceRegistryDoc,
  VerificationStatus,
} from "../src/lib/types";

const CATALOG_PATH = resolve(process.cwd(), "mockup", "API & Datasource Sets.md");
/** Priority, role and update cadence per source — the other half of the spec. */
const CONFLICT_CATALOG_PATH = resolve(process.cwd(), "mockup", "Conflict Data Sources.md");
const DEFAULT_MONGODB_URI =
  "mongodb://root:changeme@localhost:27017/palantir_th?authSource=admin";

type ConnectorAccess = "public" | "credentialed" | "licensed";

interface RegisteredSource extends SourceRegistryDoc {
  connector: SourceRegistryDoc["connector"] & {
    access: ConnectorAccess;
    catalog_urls: string[];
  };
}

interface CatalogSection {
  heading: string;
  urls: string[];
}

/** One row of the priority table in Conflict Data Sources.md. */
interface ConflictCatalogEntry {
  source: string;
  priority: "P0" | "P1" | "P2";
  method: string;
  fields: string;
  /** บทบาทในระบบ — e.g. "Conflict Backbone", "Official Claim". */
  role: string;
  updateCadence: string;
}

interface SourcePayload {
  externalId: string;
  url: string;
  publishedAt?: Date;
  raw: unknown;
  response?: {
    status: number;
    content_type: string;
    etag?: string;
    last_modified?: string;
  };
  dataset?: { name: string; version?: string };
}

interface RawRecordDoc {
  _id: string;
  source_id: string;
  external_id: string;
  retrieved_at: Date;
  source: {
    url: string;
    published_at?: Date;
    http_status?: number;
    content_type?: string;
    etag?: string;
    last_modified?: string;
  };
  dataset?: { name: string; version?: string };
  raw: unknown;
  integrity: { content_hash: string; algorithm: "sha256" };
  processing: { status: "pending" | "normalized" };
  ingestion_run_id: string;
}

interface IngestCounts {
  downloaded: number;
  new: number;
  updated: number;
  duplicate: number;
  failed: number;
}

class SkippedSourceError extends Error {}

function numberFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** Minimal .env loader so the script does not require dotenv. */
function loadEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadEnv();

/**
 * Some public endpoints are slow rather than broken — ศอ.บต. Open Data returns
 * ~4 MB and takes well over 20s — so this is generous and configurable rather
 * than a tight default that reports healthy sources as failed.
 *
 * Declared after loadEnv() so a value in .env is actually picked up.
 */
const REQUEST_TIMEOUT_MS = numberFromEnv("INGEST_REQUEST_TIMEOUT_MS", 60_000);
const MAX_RESPONSE_BYTES = numberFromEnv("INGEST_MAX_RESPONSE_BYTES", 8 * 1024 * 1024);
const MAX_API_RECORDS = numberFromEnv("INGEST_MAX_API_RECORDS", 2_000);
const USER_AGENT =
  process.env.INGEST_USER_AGENT ??
  "Palantir-TH/0.1 open-source research ingest (+https://github.com/)";

function parseCatalog(markdown: string): CatalogSection[] {
  const sections: CatalogSection[] = [];
  let current: CatalogSection | undefined;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);
    if (heading) {
      current = { heading: heading[1], urls: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    for (const match of line.matchAll(/https?:\/\/[^\s)]+/g)) {
      current.urls.push(match[0].replace(/[.,;]+$/, ""));
    }
  }
  return sections;
}

/**
 * Parse the priority table in Conflict Data Sources.md.
 *
 * Priority, role and update cadence are editorial decisions about each source,
 * so they belong in the catalog document rather than in this script. Reading
 * them keeps the registry honest — previously every P0 source was registered as
 * P1 because the value was hard-coded here and drifted from the spec.
 */
function parseConflictCatalog(markdown: string): ConflictCatalogEntry[] {
  const entries: ConflictCatalogEntry[] = [];
  const clean = (s: string) => s.replace(/\*\*/g, "").trim();

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(clean);
    if (cells.length < 6) continue;
    const priority = cells[0];
    // Skips the header row and the |---| separator without special-casing them.
    if (!/^P[012]$/.test(priority)) continue;
    entries.push({
      priority: priority as ConflictCatalogEntry["priority"],
      source: cells[1],
      method: cells[2],
      fields: cells[3],
      role: cells[4],
      updateCadence: cells[5],
    });
  }
  return entries;
}

/**
 * Match a registry entry to its catalog row. The two documents spell some
 * sources differently ("ศปก.ตร.สน." vs "ตร.สน."), so match on a distinctive
 * fragment rather than requiring the names to be identical.
 */
function conflictEntryFor(
  entries: ConflictCatalogEntry[],
  fragment: string,
): ConflictCatalogEntry {
  const entry = entries.find((e) => e.source.includes(fragment));
  if (!entry) {
    throw new Error(
      `No row matching "${fragment}" in ${CONFLICT_CATALOG_PATH}; ` +
        `found: ${entries.map((e) => e.source).join(", ")}`,
    );
  }
  return entry;
}

/**
 * Registry id -> a fragment that identifies its row in the priority table.
 * `src_sbpac_opendata` is intentionally absent: ศอ.บต. Open Data appears only
 * in the URL catalog, so it keeps the priority declared in this file.
 */
const CONFLICT_CATALOG_FRAGMENT: Record<string, string> = {
  src_dsw: "DSW-CID",
  src_isoc4: "กอ.รมน.ภาค 4",
  src_police_south: "ศปก.ตร.สน.",
  src_sbpinv: "บก.สส.จชต.",
  src_acled: "ACLED",
  src_ucdp_ged: "UCDP GED",
  src_ucdp_candidate: "UCDP Candidate",
  src_gtd: "GTD",
};

/** Overlay the catalog's priority, role and cadence onto the built registry. */
function applyConflictCatalog(
  sources: RegisteredSource[],
  entries: ConflictCatalogEntry[],
): RegisteredSource[] {
  return sources.map((source) => {
    const fragment = CONFLICT_CATALOG_FRAGMENT[source._id];
    if (!fragment) return source;
    const entry = conflictEntryFor(entries, fragment);
    return {
      ...source,
      priority: entry.priority,
      role: entry.role,
      // The document states the real cadence ("Near real-time", "Annual",
      // "Historical only"); the mode stays a connector concern.
      schedule: { ...source.schedule, frequency: entry.updateCadence },
    };
  });
}

function findCatalogSection(
  sections: CatalogSection[],
  predicate: (section: CatalogSection) => boolean,
  label: string,
): CatalogSection {
  const section = sections.find(predicate);
  if (!section || section.urls.length === 0) {
    throw new Error(`Missing ${label} URL in ${CATALOG_PATH}`);
  }
  return section;
}

function sectionByHost(sections: CatalogSection[], host: string): CatalogSection {
  return findCatalogSection(
    sections,
    (section) => section.urls.some((url) => new URL(url).hostname.includes(host)),
    host,
  );
}

function buildSources(sections: CatalogSection[]): RegisteredSource[] {
  const dsw = sectionByHost(sections, "deepsouthwatch.org");
  const isoc = sectionByHost(sections, "southpeace.go.th");
  const police = sectionByHost(sections, "rtpoc.police.go.th");
  const sbpinv = sectionByHost(sections, "sbpinv.p9.police.go.th");
  const acled = findCatalogSection(sections, (s) => s.heading === "ACLED", "ACLED");
  const ucdpGed = findCatalogSection(sections, (s) => s.heading === "UCDP GED", "UCDP GED");
  const ucdpCandidate = findCatalogSection(
    sections,
    (s) => s.heading === "UCDP Candidate",
    "UCDP Candidate",
  );
  const gtd = findCatalogSection(sections, (s) => s.heading === "GTD", "GTD");
  const sbpac = sectionByHost(sections, "opendata.sbpac.go.th");

  const source = (
    base: Omit<RegisteredSource, "enabled">,
    enabled: boolean,
  ): RegisteredSource => ({ ...base, enabled });

  return [
    source(
      {
        _id: "src_dsw",
        name: "Deep South Watch – DSW-CID",
        shortName: "DSW-CID",
        category: "conflict_event",
        priority: "P1",
        connector: {
          type: "SCRAPER",
          endpoint: dsw.urls[0],
          access: "public",
          catalog_urls: dsw.urls,
        },
        schedule: { mode: "incremental", frequency: "daily" },
        trust: { class: "external_dataset", score: 88 },
      },
      true,
    ),
    source(
      {
        _id: "src_isoc4",
        name: "กอ.รมน.ภาค 4 สน.",
        shortName: "กอ.รมน.4",
        category: "official_news",
        priority: "P1",
        connector: {
          type: "SCRAPER",
          endpoint: isoc.urls[0],
          access: "public",
          catalog_urls: isoc.urls,
        },
        schedule: { mode: "incremental", frequency: "daily" },
        trust: { class: "government", score: 86 },
      },
      true,
    ),
    source(
      {
        _id: "src_police_south",
        name: "ศปก.ตร.สน.",
        shortName: "ตร.สน.",
        category: "official_news",
        priority: "P1",
        connector: {
          type: "SCRAPER",
          endpoint: police.urls[0],
          access: "public",
          catalog_urls: police.urls,
        },
        schedule: { mode: "incremental", frequency: "daily" },
        trust: { class: "government", score: 90 },
      },
      true,
    ),
    source(
      {
        _id: "src_sbpinv",
        name: "บก.สส.จชต.",
        shortName: "บก.สส.จชต.",
        category: "official_news",
        priority: "P1",
        connector: {
          type: "SCRAPER",
          endpoint: sbpinv.urls[0],
          access: "public",
          catalog_urls: sbpinv.urls,
        },
        schedule: { mode: "incremental", frequency: "daily" },
        trust: { class: "government", score: 90 },
      },
      true,
    ),
    source(
      {
        _id: "src_acled",
        name: "Armed Conflict Location & Event Data",
        shortName: "ACLED",
        category: "conflict_event",
        priority: "P1",
        connector: {
          type: "REST_API",
          endpoint: acled.urls[0],
          access: "credentialed",
          catalog_urls: acled.urls,
        },
        schedule: { mode: "incremental", frequency: "daily" },
        trust: { class: "external_dataset", score: 84 },
      },
      Boolean(process.env.ACLED_ACCESS_TOKEN),
    ),
    source(
      {
        _id: "src_ucdp_ged",
        name: "UCDP Georeferenced Event Dataset",
        shortName: "UCDP GED",
        category: "conflict_event",
        priority: "P1",
        connector: {
          type: "REST_API",
          endpoint: ucdpGed.urls.find((url) => url.includes("apidocs")) ?? ucdpGed.urls[0],
          access: "credentialed",
          catalog_urls: ucdpGed.urls,
        },
        schedule: { mode: "versioned", frequency: "on release" },
        trust: { class: "international", score: 90 },
      },
      Boolean(process.env.UCDP_ACCESS_TOKEN || process.env.UCDP_GED_DATASET_PATH),
    ),
    source(
      {
        _id: "src_ucdp_candidate",
        name: "UCDP Candidate Events Dataset",
        shortName: "UCDP Candidate",
        category: "conflict_event",
        priority: "P1",
        connector: {
          type: "REST_API",
          endpoint:
            ucdpCandidate.urls.find((url) => url.includes("apidocs")) ?? ucdpCandidate.urls[0],
          access: "public",
          catalog_urls: ucdpCandidate.urls,
        },
        schedule: { mode: "versioned", frequency: "on release" },
        trust: { class: "international", score: 88 },
      },
      true,
    ),
    source(
      {
        _id: "src_gtd",
        name: "Global Terrorism Database",
        shortName: "GTD",
        category: "terrorism_event",
        priority: "P2",
        connector: {
          type: "DATASET",
          endpoint: gtd.urls[0],
          access: "licensed",
          catalog_urls: gtd.urls,
        },
        schedule: { mode: "versioned", frequency: "on release" },
        trust: { class: "external_dataset", score: 82 },
      },
      Boolean(process.env.GTD_DATASET_PATH),
    ),
    source(
      {
        _id: "src_sbpac_opendata",
        name: "ศอ.บต. Open Data",
        shortName: "ศอ.บต.",
        category: "government_open_data",
        priority: "P2",
        connector: {
          type: "REST_API",
          endpoint: sbpac.urls[0],
          access: "public",
          catalog_urls: sbpac.urls,
        },
        schedule: { mode: "snapshot", frequency: "daily" },
        trust: { class: "government", score: 88 },
      },
      true,
    ),
  ];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

async function fetchResponse(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json, text/csv;q=0.9, text/html;q=0.8, */*;q=0.5",
          "User-Agent": USER_AGENT,
          ...init.headers,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return response;
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 750 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to fetch ${url}`);
}

async function responsePayload(response: Response): Promise<{ raw: unknown; contentType: string }> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error(`Response is ${length} bytes; limit is ${MAX_RESPONSE_BYTES}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error(`Response is ${bytes.byteLength} bytes; limit is ${MAX_RESPONSE_BYTES}`);
  }
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const text = new TextDecoder("utf-8").decode(bytes);

  // Sniff rather than trust the declared type: ศอ.บต. Open Data serves a JSON
  // array under "text/html", and taking the header at face value archived 4 MB
  // of real incident records as an opaque HTML blob that no parser would read.
  const looksJson = /^\s*[[{]/.test(text);
  if (contentType.includes("json") || looksJson) {
    try {
      return { raw: JSON.parse(text), contentType };
    } catch {
      // Malformed, or merely HTML that happens to start with a brace: fall
      // through and preserve the text verbatim for later inspection.
    }
  }
  return { raw: { content_type: contentType, body: text }, contentType };
}

async function fetchPublicSnapshots(source: RegisteredSource): Promise<SourcePayload[]> {
  const payloads: SourcePayload[] = [];
  for (const url of source.connector.catalog_urls) {
    const response = await fetchResponse(url);
    const { raw, contentType } = await responsePayload(response);
    payloads.push({
      externalId: url,
      url: response.url || url,
      raw,
      response: {
        status: response.status,
        content_type: contentType,
        etag: response.headers.get("etag") ?? undefined,
        last_modified: response.headers.get("last-modified") ?? undefined,
      },
    });
  }
  return payloads;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rowsFromApiBody(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isRecord);
  if (!isRecord(body)) return [];
  for (const key of ["data", "Result", "result", "results", "features"]) {
    const value = body[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

async function fetchAcled(source: RegisteredSource): Promise<SourcePayload[]> {
  const token = process.env.ACLED_ACCESS_TOKEN;
  if (!token) throw new SkippedSourceError("ACLED_ACCESS_TOKEN is not configured");
  const endpoint = new URL(source.connector.catalog_urls[0]);
  endpoint.searchParams.set("country", "Thailand");
  endpoint.searchParams.set("limit", String(Math.min(MAX_API_RECORDS, 5_000)));
  const response = await fetchResponse(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { raw, contentType } = await responsePayload(response);
  const rows = rowsFromApiBody(raw).slice(0, MAX_API_RECORDS);
  if (rows.length === 0 && isRecord(raw) && raw.error) {
    throw new Error(`ACLED API error: ${String(raw.error)}`);
  }
  return rows.map((row, index) => ({
    externalId: stringValue(row.event_id_cnty, row.event_id_no_cnty, row.id) || `row-${index}`,
    url: endpoint.toString(),
    publishedAt: parseDate(row.timestamp, row.event_date),
    raw: row,
    response: { status: response.status, content_type: contentType },
    dataset: { name: "ACLED" },
  }));
}

async function fetchUcdp(
  source: RegisteredSource,
  kind: "ged" | "candidate",
): Promise<SourcePayload[]> {
  const localPath =
    kind === "ged" ? process.env.UCDP_GED_DATASET_PATH : process.env.UCDP_CANDIDATE_DATASET_PATH;
  const version =
    kind === "ged"
      ? (process.env.UCDP_GED_VERSION ?? "26.1")
      : (process.env.UCDP_CANDIDATE_VERSION ?? "26.0.7");
  if (localPath) return readLocalDataset(localPath, source, `UCDP ${kind}`, version);

  const token = process.env.UCDP_ACCESS_TOKEN;
  if (!token && kind === "candidate") {
    return fetchUcdpCandidateDownload(source, version);
  }
  if (!token) {
    throw new SkippedSourceError(
      `UCDP_ACCESS_TOKEN or UCDP_${kind === "ged" ? "GED" : "CANDIDATE"}_DATASET_PATH is not configured`,
    );
  }

  const pageSize = Math.min(1_000, MAX_API_RECORDS);
  const payloads: SourcePayload[] = [];
  let page = 0;
  while (payloads.length < MAX_API_RECORDS) {
    const endpoint = new URL(`https://ucdpapi.pcr.uu.se/api/gedevents/${encodeURIComponent(version)}`);
    endpoint.searchParams.set("pagesize", String(pageSize));
    endpoint.searchParams.set("page", String(page));
    endpoint.searchParams.set("Geography", "5.50,99.90,8.10,102.30");
    const response = await fetchResponse(endpoint.toString(), {
      headers: { "x-ucdp-access-token": token },
    });
    const { raw, contentType } = await responsePayload(response);
    const rows = rowsFromApiBody(raw);
    for (const row of rows.slice(0, MAX_API_RECORDS - payloads.length)) {
      const id = stringValue(row.id, row.event_id, row.legacy_id) || sha256(stableJson(row)).slice(0, 20);
      payloads.push({
        externalId: `${version}:${id}`,
        url: endpoint.toString(),
        publishedAt: parseDate(row.date_start, row.date_end),
        raw: row,
        response: { status: response.status, content_type: contentType },
        dataset: { name: kind === "ged" ? "UCDP GED" : "UCDP Candidate GED", version },
      });
    }
    if (rows.length < pageSize || rows.length === 0) break;
    page += 1;
  }
  return payloads;
}

async function fetchUcdpCandidateDownload(
  source: RegisteredSource,
  version: string,
): Promise<SourcePayload[]> {
  const downloadCenter =
    source.connector.catalog_urls.find((url) => url.includes("/downloads")) ??
    "https://ucdp.uu.se/downloads/";
  const filename = `GEDEvent_v${version.replace(/\./g, "_")}.csv`;
  const datasetUrl = new URL(`candidateged/${filename}`, downloadCenter).toString();
  const response = await fetchResponse(datasetUrl);
  const { raw, contentType } = await responsePayload(response);
  if (!isRecord(raw) || typeof raw.body !== "string") {
    throw new Error(`UCDP Candidate download is not CSV: ${datasetUrl}`);
  }

  // The public file is global. Seed only the four provinces in the investigation
  // scope while preserving every original column of each selected row.
  const rows = parseCsv(raw.body).filter((row) =>
    Boolean(provinceFrom(row.adm_1 ?? row.admin1 ?? row.province)),
  );
  return rows.slice(0, MAX_API_RECORDS).map((row, index) => ({
    externalId: `${version}:${stringValue(row.id, row.event_id) || `row-${index}`}`,
    url: datasetUrl,
    publishedAt: parseDate(row.date_start, row.date_end),
    raw: row,
    response: {
      status: response.status,
      content_type: contentType,
      etag: response.headers.get("etag") ?? undefined,
      last_modified: response.headers.get("last-modified") ?? undefined,
    },
    dataset: { name: "UCDP Candidate GED", version },
  }));
}

function readLocalDataset(
  pathValue: string,
  source: RegisteredSource,
  datasetName: string,
  version?: string,
): SourcePayload[] {
  const path = resolve(process.cwd(), pathValue);
  if (!existsSync(path)) throw new Error(`Dataset file does not exist: ${path}`);
  const extension = extname(path).toLowerCase();
  const text = readFileSync(path, "utf8");
  let rows: Record<string, unknown>[];
  if (extension === ".json") rows = rowsFromApiBody(JSON.parse(text));
  else if (extension === ".csv") rows = parseCsv(text);
  else throw new Error(`Unsupported ${extension}; export the licensed dataset as CSV or JSON`);

  return rows.slice(0, MAX_API_RECORDS).map((row, index) => ({
    externalId:
      stringValue(row.eventid, row.event_id, row.id, row.legacy_id) ||
      sha256(stableJson(row)).slice(0, 20) ||
      `row-${index}`,
    url: source.connector.endpoint ?? path,
    publishedAt: parseDate(row.event_date, row.date_start, row.iyear),
    raw: row,
    dataset: { name: datasetName, version },
  }));
}

function parseCsv(text: string): Record<string, string>[] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) table.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) table.push(row);
  const [headers = [], ...rows] = table;
  return rows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim(), values[index] ?? ""])),
  );
}

async function collectPayloads(source: RegisteredSource): Promise<SourcePayload[]> {
  switch (source._id) {
    case "src_acled":
      return fetchAcled(source);
    case "src_ucdp_ged":
      return fetchUcdp(source, "ged");
    case "src_ucdp_candidate":
      return fetchUcdp(source, "candidate");
    case "src_gtd": {
      const path = process.env.GTD_DATASET_PATH;
      if (!path) throw new SkippedSourceError("GTD_DATASET_PATH is not configured (licensed download)");
      return readLocalDataset(path, source, "GTD", process.env.GTD_DATASET_VERSION);
    }
    default:
      return fetchPublicSnapshots(source);
  }
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function numberValue(...values: unknown[]): number {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseDate(...values: unknown[]): Date | undefined {
  for (const value of values) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number" && value >= 1900 && value <= 2200) {
      return new Date(Date.UTC(value, 0, 1));
    }
    if (typeof value !== "string" || !value.trim()) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    const dmy = value.match(/^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4})$/);
    if (dmy) {
      const retry = new Date(`${dmy[2]} ${dmy[1]}, ${dmy[3]} UTC`);
      if (!Number.isNaN(retry.getTime())) return retry;
    }
  }
  return undefined;
}

const PROVINCE_ALIASES: { code: ProvinceCode; name: string; aliases: string[] }[] = [
  { code: "pattani", name: "ปัตตานี", aliases: ["pattani", "ปัตตานี"] },
  { code: "yala", name: "ยะลา", aliases: ["yala", "ยะลา"] },
  { code: "narathiwat", name: "นราธิวาส", aliases: ["narathiwat", "นราธิวาส"] },
  { code: "songkhla", name: "สงขลา", aliases: ["songkhla", "สงขลา"] },
];

function provinceFrom(value: unknown): (typeof PROVINCE_ALIASES)[number] | undefined {
  const normalized = stringValue(value).toLocaleLowerCase("en-US");
  return PROVINCE_ALIASES.find((province) =>
    province.aliases.some((alias) => normalized.includes(alias)),
  );
}

function eventTypeFrom(value: unknown): EventType {
  const normalized = stringValue(value).toLocaleLowerCase("en-US");
  if (/explosion|bomb|ied|shelling|grenade|ระเบิด/.test(normalized)) return "explosion";
  if (/shoot|gunfire|armed clash|ยิง|ปะทะ/.test(normalized)) return "shooting";
  if (/arson|fire|วางเพลิง/.test(normalized)) return "arson";
  if (/abduct|kidnap|ลักพา/.test(normalized)) return "abduction";
  if (/raid|arrest|search|จับกุม|ตรวจค้น/.test(normalized)) return "raid";
  if (/drug|narcotic|ยาเสพติด/.test(normalized)) return "narcotics";
  return "unrest";
}

function geoPrecisionFrom(sourceId: string, value: unknown): GeoPrecision {
  const precision = numberValue(value);
  if (sourceId.startsWith("src_ucdp")) {
    if (precision === 1) return "village";
    if (precision === 2) return "subdistrict";
    if (precision === 3 || precision === 4) return "district";
    if (precision >= 5) return "province";
  }
  return "unknown";
}

function severityFrom(killed: number, injured: number): SeverityLevel {
  const impact = Math.max(0, killed) * 3 + Math.max(0, injured);
  if (impact >= 20) return 5;
  if (impact >= 8) return 4;
  if (impact >= 3) return 3;
  if (impact >= 1) return 2;
  return 1;
}

/**
 * Thai Buddhist-era date, "DD/MM/BBBB" as published by ศอ.บต. Open Data.
 * 543 years ahead of the Gregorian calendar; anything outside a sane range is
 * treated as unparseable rather than silently shifted.
 */
function parseThaiBuddhistDate(value: unknown): Date | undefined {
  const match = stringValue(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]) - 543;
  if (year < 1970 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** App province slug -> DDPM numeric code, the join key to the boundary data. */
const PROVINCE_DDPM_CODE: Record<string, string> = Object.fromEntries(
  PROVINCES.map((province) => [province.code, province.ddpmCode]),
);

const stripThaiPrefix = (value: unknown, prefix: string) =>
  stringValue(value).replace(new RegExp(`^${prefix}\\s*`), "").trim();

const MEDIA_FIELDS = ["AccImage1", "AccImage2", "AccImage3"] as const;

/** True when the row carries at least one of these keys with a usable value. */
function hasAnyField(row: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => {
    const value = row[key];
    return value !== undefined && value !== null && value !== "";
  });
}

/**
 * Columns the ACLED/UCDP/GTD mapper consumes. Everything else in those rows —
 * and these datasets are wide — is carried through in `attributes` rather than
 * discarded, so source-specific vocabulary stays queryable.
 */
const DATASET_MAPPED_FIELDS = new Set<string>([
  "admin1", "adm_1", "provstate", "province",
  "admin2", "adm_2", "admin3", "adm_3", "location", "city",
  "longitude", "lon", "latitude", "lat", "where_prec",
  "event_date", "date_start", "date", "iyear",
  "fatalities", "best", "nkill", "injuries", "injured", "nwound",
  "sub_event_type", "event_type", "type_of_violence", "attacktype1_txt",
  "source_headline", "notes", "summary",
  "actor1", "actor2", "side_a", "side_b", "gname",
]);

/** Source fields that map onto canonical columns; the rest go to `attributes`. */
const SBPAC_MAPPED_FIELDS = new Set<string>([
  "AccDate",
  "AccProvince",
  "AccAmphur",
  "AccTumbol",
  "AccLocation",
  "AccType",
  ...MEDIA_FIELDS,
]);

/**
 * AccType records whether the tripartite committee (คณะกรรมการ 3 ฝ่าย) endorsed
 * the incident — a verification state, not an incident category. Treating it as
 * an event type discarded the strongest signal in the dataset: over 9,000
 * records carry an official endorsement and were all being filed as unverified.
 */
function sbpacVerification(rawType: string): VerificationStatus {
  if (rawType.includes("ไม่รับรอง")) return "unverifiable";
  if (rawType.includes("รับรอง")) return "verified";
  if (rawType.includes("อยู่ระหว่าง")) return "under_review";
  return "under_review";
}

/**
 * Every source field with a value that no canonical column claimed. Empty
 * strings are dropped (they carry nothing), but explicit nulls are kept so the
 * record still shows the source addressed the field.
 */
function unmappedAttributes(
  row: Record<string, unknown>,
  mapped: Set<string>,
): Record<string, string | number | boolean | null> {
  const attributes: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(row)) {
    if (mapped.has(key)) continue;
    if (value === undefined || value === "") continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attributes[key] = value;
    } else {
      // Nested structures are flattened to text rather than dropped.
      attributes[key] = JSON.stringify(value);
    }
  }
  return attributes;
}

/**
 * ศอ.บต. Open Data: 10k+ relief records naming ตำบล/อำเภอ/จังหวัด but carrying
 * no coordinates. Position is therefore resolved from the district polygon and
 * labelled `district` precision, so the map shows where the district is rather
 * than implying a fix the source never gave. Fields the source omits — notably
 * casualties — stay null instead of being defaulted to zero.
 */
function normalizeSbpacEvent(
  source: RegisteredSource,
  payload: SourcePayload,
  rawRecordId: string,
): EventCandidateDoc | undefined {
  if (!isRecord(payload.raw)) return undefined;
  const row = payload.raw;

  const province = provinceFrom(row.AccProvince);
  const occurredAt = parseThaiBuddhistDate(row.AccDate);
  if (!province || !occurredAt) return undefined;

  const districtName = stripThaiPrefix(row.AccAmphur, "อำเภอ");
  const district = districtsOfProvince(PROVINCE_DDPM_CODE[province.code]).find(
    (candidate) => candidate.nameTh === districtName,
  );
  if (!district) return undefined;

  const rawType = stringValue(row.AccType);
  const subdistrict = stripThaiPrefix(row.AccTumbol, "ตำบล") || null;
  const place = stringValue(row.AccLocation) || null;

  const media = MEDIA_FIELDS.flatMap((field) => {
    const url = stringValue(row[field]);
    return url ? [{ url, kind: "image" as const, field }] : [];
  });

  return {
    _id: `evt_${sha256(`${source._id}\0${payload.externalId}\0${rawRecordId}`).slice(0, 24)}`,
    source_id: source._id,
    raw_record_id: rawRecordId,
    time: { start: occurredAt, precision: "day" },
    location: {
      province: province.name,
      provinceCode: province.code,
      district: district.nameTh,
      subdistrict,
      place,
      geo: { type: "Point", coordinates: representativePoint(district.geometry) },
      geo_precision: "district",
    },
    event: {
      // AccType is a committee endorsement status, not an incident category —
      // see the verification mapping below. Every record in this dataset is an
      // unrest incident, so the type is the dataset's own scope.
      type: "unrest",
      title: [place, subdistrict && `ต.${subdistrict}`, `อ.${district.nameTh}`]
        .filter(Boolean)
        .join(" ")
        .slice(0, 300),
      rawType: rawType || null,
    },
    // Nothing in the record implies a severity, so none is asserted.
    severity: null,
    verification: sbpacVerification(rawType),
    confidence: source.trust.score,
    casualties: { killed: null, injured: null },
    actors: [],
    targets: [],
    corroborating_sources: [source._id],
    media,
    attributes: unmappedAttributes(row, SBPAC_MAPPED_FIELDS),
    unreported: ["severity", "casualties", "actors", "targets", "coordinates"],
  };
}

function normalizeEvent(
  source: RegisteredSource,
  payload: SourcePayload,
  rawRecordId: string,
): EventCandidateDoc | undefined {
  if (!isRecord(payload.raw)) return undefined;
  if (source._id === "src_sbpac_opendata") {
    return normalizeSbpacEvent(source, payload, rawRecordId);
  }
  if (!["src_acled", "src_ucdp_ged", "src_ucdp_candidate", "src_gtd"].includes(source._id)) {
    return undefined;
  }
  const row = payload.raw;
  const province = provinceFrom(row.admin1 ?? row.adm_1 ?? row.provstate ?? row.province);
  const longitude = numberValue(row.longitude, row.lon);
  const latitude = numberValue(row.latitude, row.lat);
  const occurredAt = parseDate(row.event_date, row.date_start, row.date, row.iyear);
  if (!province || !occurredAt || longitude < 99 || longitude > 103 || latitude < 5 || latitude > 9) {
    return undefined;
  }
  // Distinguish "reported as zero" from "never reported": only count a figure
  // when the source actually carries one of these fields.
  const reportsKilled = hasAnyField(row, ["fatalities", "best", "nkill"]);
  const reportsInjured = hasAnyField(row, ["injuries", "injured", "nwound"]);
  const killed = reportsKilled
    ? Math.max(0, Math.round(numberValue(row.fatalities, row.best, row.nkill)))
    : null;
  const injured = reportsInjured
    ? Math.max(0, Math.round(numberValue(row.injuries, row.injured, row.nwound)))
    : null;
  const rawType = stringValue(row.sub_event_type, row.event_type, row.type_of_violence, row.attacktype1_txt);
  const type = eventTypeFrom(rawType);
  const district = stringValue(row.admin2, row.adm_2, row.location, row.city) || "ไม่ระบุอำเภอ";
  const subdistrict = stringValue(row.admin3, row.adm_3) || null;
  const headline = stringValue(row.source_headline, row.notes, row.summary);
  const title = headline || `${rawType || "เหตุการณ์ความขัดแย้ง"} — ${district}`;
  const actors = [row.actor1, row.actor2, row.side_a, row.side_b, row.gname]
    .map((value) => stringValue(value))
    .filter(Boolean);

  return {
    _id: `evt_${sha256(`${source._id}\0${payload.externalId}\0${rawRecordId}`).slice(0, 24)}`,
    source_id: source._id,
    raw_record_id: rawRecordId,
    time: { start: occurredAt, precision: "day" },
    location: {
      province: province.name,
      provinceCode: province.code,
      district,
      subdistrict,
      place: stringValue(row.location, row.city) || null,
      geo: { type: "Point", coordinates: [longitude, latitude] },
      geo_precision: geoPrecisionFrom(source._id, row.where_prec),
    },
    event: {
      type,
      title: title.slice(0, 300),
      summary: headline ? headline.slice(0, 2_000) : undefined,
      rawType: rawType || null,
    },
    // Severity here is inferred from casualties; with neither figure reported
    // there is nothing to infer it from.
    severity: killed === null && injured === null ? null : severityFrom(killed ?? 0, injured ?? 0),
    verification: "under_review",
    confidence: source.trust.score,
    casualties: { killed, injured },
    actors: [...new Set(actors)],
    targets: [],
    corroborating_sources: [source._id],
    media: [],
    attributes: unmappedAttributes(row, DATASET_MAPPED_FIELDS),
    unreported: [
      ...(killed === null ? ["casualties.killed"] : []),
      ...(injured === null ? ["casualties.injured"] : []),
    ],
  };
}

function buildRawRecord(
  source: RegisteredSource,
  payload: SourcePayload,
  runId: string,
  retrievedAt: Date,
): RawRecordDoc {
  const digest = sha256(`${source._id}\0${payload.externalId}\0${stableJson(payload.raw)}`);
  const rawId = `raw_${source._id.replace(/^src_/, "")}_${digest.slice(0, 24)}`;
  const candidate = normalizeEvent(source, payload, rawId);
  return {
    _id: rawId,
    source_id: source._id,
    external_id: payload.externalId,
    retrieved_at: retrievedAt,
    source: {
      url: payload.url,
      published_at: payload.publishedAt,
      http_status: payload.response?.status,
      content_type: payload.response?.content_type,
      etag: payload.response?.etag,
      last_modified: payload.response?.last_modified,
    },
    dataset: payload.dataset,
    raw: payload.raw,
    integrity: { content_hash: `sha256:${digest}`, algorithm: "sha256" },
    processing: { status: candidate ? "normalized" : "pending" },
    ingestion_run_id: runId,
  };
}

async function persistPayloads(
  db: Db,
  source: RegisteredSource,
  runId: string,
  payloads: SourcePayload[],
): Promise<IngestCounts> {
  const counts: IngestCounts = {
    downloaded: payloads.length,
    new: 0,
    updated: 0,
    duplicate: 0,
    failed: 0,
  };
  const rawCollection = db.collection<RawRecordDoc>("raw_records");
  const candidates = db.collection<EventCandidateDoc>("event_candidates");
  for (const payload of payloads) {
    try {
      const raw = buildRawRecord(source, payload, runId, new Date());
      const result = await rawCollection.updateOne(
        { "integrity.content_hash": raw.integrity.content_hash },
        { $setOnInsert: raw },
        { upsert: true },
      );
      if (result.upsertedCount === 1) counts.new += 1;
      else counts.duplicate += 1;
      const event = normalizeEvent(source, payload, raw._id);
      if (event) {
        await candidates.updateOne({ _id: event._id }, { $setOnInsert: event }, { upsert: true });
      }
    } catch (error) {
      counts.failed += 1;
      console.error(`    record ${payload.externalId}: ${errorMessage(error)}`);
    }
  }
  return counts;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sources that answer with one document containing many records. The archive
 * keeps that document whole — it is the original artifact — and the split into
 * one record per row happens here, at load time.
 */
const ROW_ORIENTED_SOURCES = new Set(["src_sbpac_opendata"]);

function expandRowPayloads(
  source: RegisteredSource,
  payloads: SourcePayload[],
): SourcePayload[] {
  if (!ROW_ORIENTED_SOURCES.has(source._id)) return payloads;

  const expanded: SourcePayload[] = [];
  for (const payload of payloads) {
    const rows = rowsFromApiBody(payload.raw);
    if (rows.length === 0) {
      // Not the expected shape — keep the payload as-is rather than dropping it.
      expanded.push(payload);
      continue;
    }
    rows.forEach((row, index) => {
      expanded.push({
        ...payload,
        // Row index keeps the id stable across runs for unchanged data, so
        // re-ingesting counts duplicates rather than inserting again.
        externalId: `${payload.externalId}#${index}`,
        raw: row,
      });
    });
  }
  return expanded;
}

/**
 * Absent values are written as null rather than dropped, so the archive states
 * "this field was not provided" instead of leaving the reader to guess.
 */
function toArchivedPayload(payload: SourcePayload): ArchivedPayload {
  return {
    externalId: payload.externalId,
    url: payload.url,
    publishedAt: payload.publishedAt ? payload.publishedAt.toISOString() : null,
    raw: payload.raw ?? null,
    response: payload.response
      ? {
          status: payload.response.status ?? null,
          content_type: payload.response.content_type ?? null,
          etag: payload.response.etag ?? null,
          last_modified: payload.response.last_modified ?? null,
        }
      : null,
    dataset: payload.dataset
      ? { name: payload.dataset.name, version: payload.dataset.version ?? null }
      : null,
  };
}

function fromArchivedPayload(payload: ArchivedPayload): SourcePayload {
  return {
    externalId: payload.externalId,
    url: payload.url,
    publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : undefined,
    raw: payload.raw,
    response: payload.response
      ? {
          status: payload.response.status ?? 0,
          content_type: payload.response.content_type ?? "application/octet-stream",
          etag: payload.response.etag ?? undefined,
          last_modified: payload.response.last_modified ?? undefined,
        }
      : undefined,
    dataset: payload.dataset
      ? { name: payload.dataset.name, version: payload.dataset.version ?? undefined }
      : undefined,
  };
}

/**
 * Stage 1: fetch from the network and archive to disk. Touches no database, so
 * it can be run on its own and re-run without loading anything.
 */
async function fetchSourceToArchive(source: RegisteredSource): Promise<void> {
  const startedAt = new Date();
  const runId = `${startedAt.toISOString().replace(/[:.]/g, "-")}`;
  try {
    const payloads = await collectPayloads(source);
    const manifest = writeArchive(
      source._id,
      runId,
      startedAt,
      payloads.map(toArchivedPayload),
    );
    const files = manifest.entries.filter((entry) => entry.file).length;
    console.log(
      `  ${source._id.padEnd(22)} archived payloads=${manifest.payload_count} files=${files} -> data/raw/${source._id}/${runId}`,
    );
  } catch (error) {
    const skipped = error instanceof SkippedSourceError;
    console.log(
      `  ${source._id.padEnd(22)} ${(skipped ? "skipped" : "failed").padEnd(8)} ${errorMessage(error)}`,
    );
  }
}

async function runSource(db: Db, source: RegisteredSource, fromArchive: boolean): Promise<void> {
  const startedAt = new Date();
  const runId = `run_${source._id}_${startedAt.toISOString().replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const runs = db.collection<IngestionRunDoc>("ingestion_runs");
  const empty: IngestCounts = { downloaded: 0, new: 0, updated: 0, duplicate: 0, failed: 0 };
  await runs.insertOne({
    _id: runId,
    source_id: source._id,
    started_at: startedAt,
    finished_at: null,
    status: "running",
    records: empty,
  });
  try {
    let payloads: SourcePayload[];
    if (fromArchive) {
      // Stage 2 must not reach the network: an empty archive is an error to
      // report, never a reason to silently re-fetch.
      const archived = readLatestArchive(source._id);
      if (!archived) {
        throw new SkippedSourceError(
          `no archived payloads in data/raw/${source._id} — run "npm run ingest:fetch" first`,
        );
      }
      payloads = archived.payloads.map(fromArchivedPayload);
    } else {
      payloads = await collectPayloads(source);
    }
    const counts = await persistPayloads(db, source, runId, expandRowPayloads(source, payloads));
    const status = counts.failed > 0 ? "partial" : "success";
    await runs.updateOne(
      { _id: runId },
      { $set: { finished_at: new Date(), status, records: counts } },
    );
    console.log(
      `  ${source._id.padEnd(22)} ${status.padEnd(7)} downloaded=${counts.downloaded} new=${counts.new} duplicate=${counts.duplicate} failed=${counts.failed}`,
    );
  } catch (error) {
    const skipped = error instanceof SkippedSourceError;
    await runs.updateOne(
      { _id: runId },
      {
        $set: {
          finished_at: new Date(),
          status: skipped ? "skipped" : "failed",
          records: { ...empty, failed: skipped ? 0 : 1 },
          error: errorMessage(error),
        },
      },
    );
    console.log(
      `  ${source._id.padEnd(22)} ${(skipped ? "skipped" : "failed").padEnd(7)} ${errorMessage(error)}`,
    );
  }
}

async function removeLegacyFixtures(db: Db): Promise<number> {
  const raw = db.collection<RawRecordDoc>("raw_records");
  const legacyRaw = await raw
    .find({ "source.url": /^https:\/\/example\.invalid\// }, { projection: { _id: 1 } })
    .toArray();
  const ids = legacyRaw.map((record) => record._id);
  let removed = 0;
  if (ids.length > 0) {
    removed +=
      (
        await db
          .collection<{ _id: string; raw_record_id: string }>("event_candidates")
          .deleteMany({ raw_record_id: { $in: ids } })
      ).deletedCount;
    removed += (await raw.deleteMany({ _id: { $in: ids } })).deletedCount;
  }
  removed +=
    (await db.collection<{ _id: string }>("citizen_reports").deleteMany({ _id: /^cr_\d+_\d+$/ }))
      .deletedCount;
  removed +=
    (await db.collection<{ _id: string }>("cases").deleteMany({ _id: "case_2024_0517" }))
      .deletedCount;
  removed +=
    (await db.collection<{ _id: string }>("ingestion_runs").deleteMany({ _id: /^run_src_.+_\d+$/ }))
      .deletedCount;
  removed +=
    (
      await db.collection<{ _id: string }>("source_registry").deleteMany({
        _id: { $in: ["src_dsi_wcid", "src_ucdp", "src_local_news", "src_thaipbs", "src_citizen"] },
      })
    ).deletedCount;
  return removed;
}

async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("raw_records").createIndexes([
    { key: { "integrity.content_hash": 1 }, unique: true },
    { key: { source_id: 1, external_id: 1, retrieved_at: -1 } },
  ]);
  await db.collection("event_candidates").createIndexes([
    { key: { raw_record_id: 1 }, unique: true },
    { key: { "time.start": -1 } },
    { key: { "location.provinceCode": 1, "event.type": 1 } },
    { key: { "location.geo": "2dsphere" } },
    { key: { verification: 1 } },
  ]);
  await db.collection("citizen_reports").createIndex({ reported_at: -1 });
  await db.collection("ingestion_runs").createIndex({ source_id: 1, started_at: -1 });
}

async function resetDevelopmentCollections(db: Db): Promise<void> {
  for (const name of [
    "source_registry",
    "ingestion_runs",
    "raw_records",
    "event_candidates",
    "canonical_events",
    "processing_logs",
    "cases",
    "citizen_reports",
  ]) {
    await db.collection(name).deleteMany({});
  }
}

async function upsertRegistry(
  collection: Collection<RegisteredSource>,
  sources: RegisteredSource[],
): Promise<void> {
  if (sources.length === 0) return;
  await collection.bulkWrite(
    sources.map((source) => ({
      replaceOne: { filter: { _id: source._id }, replacement: source, upsert: true },
    })),
  );
}

async function main(): Promise<void> {
  if (!existsSync(CATALOG_PATH)) throw new Error(`Source catalog not found: ${CATALOG_PATH}`);
  if (!existsSync(CONFLICT_CATALOG_PATH)) {
    throw new Error(`Priority catalog not found: ${CONFLICT_CATALOG_PATH}`);
  }
  const sources = applyConflictCatalog(
    buildSources(parseCatalog(readFileSync(CATALOG_PATH, "utf8"))),
    parseConflictCatalog(readFileSync(CONFLICT_CATALOG_PATH, "utf8")),
  );
  const sourceFilter = process.argv
    .find((argument) => argument.startsWith("--source="))
    ?.slice("--source=".length);
  const selectedSources = sourceFilter
    ? sources.filter((source) => source._id === sourceFilter)
    : sources;
  if (sourceFilter && selectedSources.length === 0) {
    throw new Error(`Unknown source ${sourceFilter}; expected one of ${sources.map((source) => source._id).join(", ")}`);
  }
  // Two stages, runnable together or apart:
  //   --fetch-only    network -> data/raw, no database
  //   --from-archive  data/raw -> database, no network
  // Running neither does both, fetching and then loading what it just wrote.
  const fetchOnly = process.argv.includes("--fetch-only");
  const fromArchive = process.argv.includes("--from-archive");
  if (fetchOnly && fromArchive) {
    throw new Error("--fetch-only and --from-archive are mutually exclusive");
  }

  if (fetchOnly || !fromArchive) {
    console.log(`Fetching ${selectedSources.length} source(s) to data/raw:`);
    for (const source of selectedSources) await fetchSourceToArchive(source);
    if (fetchOnly) {
      console.log("\nFetch complete. Load it with: npm run ingest:load");
      return;
    }
    console.log("");
  }

  const uri = process.env.MONGODB_URI ?? DEFAULT_MONGODB_URI;
  const dbName = process.env.MONGODB_DB ?? "palantir_th";
  const client = await new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 }).connect();
  try {
    const db = client.db(dbName);
    if (process.argv.includes("--force")) {
      await resetDevelopmentCollections(db);
      console.log(`Reset ${dbName} (--force).`);
    } else {
      const removed = await removeLegacyFixtures(db);
      if (removed > 0) console.log(`Removed ${removed} legacy fixture documents.`);
    }
    await ensureIndexes(db);
    await upsertRegistry(db.collection<RegisteredSource>("source_registry"), sources);
    console.log(`Loaded ${sources.length} source definitions from ${CATALOG_PATH}`);
    // Always load from the archive, including right after a fetch, so what is
    // in the database is exactly what is on disk and can be reproduced from it.
    for (const source of selectedSources) await runSource(db, source, true);
    const [rawCount, eventCount] = await Promise.all([
      db.collection("raw_records").estimatedDocumentCount(),
      db.collection("event_candidates").estimatedDocumentCount(),
    ]);
    console.log(`\nIngest complete: raw_records=${rawCount}, event_candidates=${eventCount}.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});
