import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * On-disk archive of everything fetched from a source, written before anything
 * is parsed or loaded.
 *
 * MVP.md requires the original to be kept before transformation: "ข้อมูลจาก
 * ต้นทางต้องถูกเก็บก่อน transform เสมอ". Splitting fetch from load also means a
 * mapping change can be re-run against the same bytes instead of re-hitting
 * the source, which matters for sites we should not be polling repeatedly.
 *
 * Layout, one directory per run so history is never overwritten:
 *
 *   data/raw/<source_id>/<run_id>/
 *     payloads.json     every payload, machine-readable, loaded by stage 2
 *     000-<name>.html   verbatim body in the source's own format
 *     000-<name>.meta.json
 *     manifest.json     what this run fetched, with hashes
 */

export const ARCHIVE_ROOT = resolve(process.cwd(), "data", "raw");

/** Mirrors seed.ts's SourcePayload, with absent values written as null. */
export interface ArchivedPayload {
  externalId: string;
  url: string;
  publishedAt: string | null;
  raw: unknown;
  response: {
    status: number | null;
    content_type: string | null;
    etag: string | null;
    last_modified: string | null;
  } | null;
  dataset: { name: string; version: string | null } | null;
}

export interface ArchiveManifest {
  source_id: string;
  run_id: string;
  fetched_at: string;
  payload_count: number;
  entries: {
    external_id: string;
    url: string;
    /** Native-format file for this payload, relative to the run directory. */
    file: string | null;
    content_type: string | null;
    bytes: number | null;
    content_hash: string;
  }[];
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Stable stringify so an unchanged payload always hashes identically. */
function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/**
 * Extension for the verbatim artifact. HTML stays HTML and CSV stays CSV —
 * rewriting them as JSON would discard the original the archive exists to keep.
 */
function extensionFor(contentType: string | null): string {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  if (type.includes("html")) return "html";
  if (type.includes("xml")) return "xml";
  if (type.includes("text/plain")) return "txt";
  return "bin";
}

/** Filesystem-safe slug taken from the URL's last meaningful segment. */
function slugFor(url: string, index: number): string {
  let tail = "payload";
  try {
    const { pathname, hostname } = new URL(url);
    const segment = pathname.split("/").filter(Boolean).pop();
    tail = (segment ?? hostname).replace(/\.[a-z0-9]+$/i, "");
  } catch {
    // Non-URL external ids (dataset rows) keep the default.
  }
  const safe = tail.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "payload";
  return `${String(index).padStart(3, "0")}-${safe}`;
}

/**
 * If the payload is a wrapped text body (`{content_type, body}` from a non-JSON
 * response), return the original text so it can be written back byte-for-byte.
 */
function verbatimBody(raw: unknown): string | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    if (typeof record.body === "string") return record.body;
  }
  return null;
}

export function runDirectory(sourceId: string, runId: string): string {
  return resolve(ARCHIVE_ROOT, sourceId, runId);
}

/** Write one run's payloads to disk and return the manifest describing it. */
export function writeArchive(
  sourceId: string,
  runId: string,
  fetchedAt: Date,
  payloads: ArchivedPayload[],
): ArchiveManifest {
  const dir = runDirectory(sourceId, runId);
  mkdirSync(dir, { recursive: true });

  const entries: ArchiveManifest["entries"] = payloads.map((payload, index) => {
    const contentType = payload.response?.content_type ?? null;
    const body = verbatimBody(payload.raw);
    const slug = slugFor(payload.url || payload.externalId, index);

    let file: string | null = null;
    let bytes: number | null = null;

    if (body !== null) {
      // Non-JSON response: keep the exact text in its own format.
      file = `${slug}.${extensionFor(contentType)}`;
      writeFileSync(resolve(dir, file), body, "utf8");
      bytes = Buffer.byteLength(body, "utf8");
    } else if (payload.raw !== null && payload.raw !== undefined) {
      // Structured payload (parsed JSON, or one dataset row): JSON is native.
      file = `${slug}.json`;
      const text = JSON.stringify(payload.raw, null, 2);
      writeFileSync(resolve(dir, file), text, "utf8");
      bytes = Buffer.byteLength(text, "utf8");
    }

    if (file) {
      writeFileSync(
        resolve(dir, `${slug}.meta.json`),
        JSON.stringify(
          {
            source_id: sourceId,
            run_id: runId,
            external_id: payload.externalId,
            url: payload.url,
            published_at: payload.publishedAt,
            fetched_at: fetchedAt.toISOString(),
            response: payload.response,
            dataset: payload.dataset,
            file,
          },
          null,
          2,
        ),
        "utf8",
      );
    }

    return {
      external_id: payload.externalId,
      url: payload.url,
      file,
      content_type: contentType,
      bytes,
      content_hash: `sha256:${sha256(stableJson(payload.raw))}`,
    };
  });

  // payloads.json is what stage 2 reads: the complete, already-shaped record.
  writeFileSync(resolve(dir, "payloads.json"), JSON.stringify(payloads, null, 2), "utf8");

  const manifest: ArchiveManifest = {
    source_id: sourceId,
    run_id: runId,
    fetched_at: fetchedAt.toISOString(),
    payload_count: payloads.length,
    entries,
  };
  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

/** Run ids for a source, oldest first. */
export function listRuns(sourceId: string): string[] {
  const dir = resolve(ARCHIVE_ROOT, sourceId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Payloads from a source's most recent archived run, or null when nothing has
 * been fetched yet. Stage 2 must never reach the network, so an empty archive
 * is reported rather than silently backfilled.
 */
export function readLatestArchive(
  sourceId: string,
): { runId: string; manifest: ArchiveManifest; payloads: ArchivedPayload[] } | null {
  const runs = listRuns(sourceId);
  const runId = runs.at(-1);
  if (!runId) return null;

  const dir = runDirectory(sourceId, runId);
  const payloadsPath = resolve(dir, "payloads.json");
  const manifestPath = resolve(dir, "manifest.json");
  if (!existsSync(payloadsPath) || !existsSync(manifestPath)) return null;

  return {
    runId,
    manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as ArchiveManifest,
    payloads: JSON.parse(readFileSync(payloadsPath, "utf8")) as ArchivedPayload[],
  };
}
